import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของ Customer Management (STEP 25)
 *
 * ใช้ฐานข้อมูลจริง สร้างบัญชีทดสอบทุกบทบาทแล้วลบทิ้งใน afterAll
 *
 * สิ่งที่ต้องพิสูจน์
 *   ฝั่งลูกค้า
 *     - แก้ได้แค่ข้อมูลของตัวเอง · `email` / `role` / `status` / `points` ยัดมาทาง body ไม่ได้
 *     - วันเกิดไม่เลื่อนวันจากโซนเวลา (คอลัมน์เป็น DATE)
 *     - ที่อยู่ของคนอื่นแก้/ลบไม่ได้ (IDOR → 404 ไม่ใช่ 403)
 *     - หนึ่งบัญชีมีที่อยู่เริ่มต้นได้ที่อยู่เดียว และลบอันเริ่มต้นแล้วมีอันใหม่ขึ้นแทน
 *     - ลบที่อยู่เป็น soft delete และไม่ทำให้ประวัติคำสั่งซื้อเสีย
 *     - แก้ที่อยู่ **ไม่เปลี่ยน** ปลายทางของคำสั่งซื้อที่สั่งไปแล้ว (ใช้ snapshot)
 *   ฝั่งหลังบ้าน
 *     - ยอดซื้อนับจากตาราง Order จริง ไม่ใช่คอลัมน์ cache `User.totalSpent`
 *     - ลูกค้าทั่วไปเปิดหลังบ้านไม่ได้ · EMPLOYEE ดูได้แต่ระงับไม่ได้
 *     - ระงับตัวเองไม่ได้ · ADMIN ระงับ ADMIN อีกคนไม่ได้
 *     - ระงับแล้ว session ถูกเพิกถอนทันที (token เดิมใช้ต่อไม่ได้)
 *     - เปลี่ยนบทบาทแล้วสิทธิ์เปลี่ยนทันทีโดยไม่ต้องล็อกอินใหม่
 *     - ทุกการเปลี่ยนสถานะ/บทบาทเขียน AdminLog พร้อมเหตุผล
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface TestUser {
  id: string;
  email: string;
  token: string;
}

const createdUserIds: string[] = [];
const createdOrderNumbers: string[] = [];

let customer: TestUser;
let otherCustomer: TestUser;
let employee: TestUser;
let admin: TestUser;
let secondAdmin: TestUser;
let superAdmin: TestUser;

/** ผู้ใช้ทดสอบ + session token ที่ backend อ่านจากตาราง Session เดียวกับ Auth.js */
async function createTestUser(role: string, tag: string): Promise<TestUser> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role as 'CUSTOMER' } });
  const email = `test-customer-${tag}-${suffix}@teenstyle.test`;

  const user = await prisma.user.create({
    data: { email, name: `ทดสอบ ${tag}`, roleId: roleRow.id, status: 'ACTIVE' },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, email, token };
}

/** เลขคำสั่งซื้อทดสอบ — ใช้ปี 2999 เพื่อไม่ชนกับเลขจริงของวันนี้ */
function testOrderNumber(): string {
  const pad = (max: number) => String(Math.floor(Math.random() * max)).padStart(4, '0');
  return `TS-2999${pad(10000)}-${pad(10000)}`;
}

/** สร้างคำสั่งซื้อตรง ๆ — สถิติของหน้าหลังบ้านอ่านจากตาราง Order ไม่ต้องมีรายการสินค้า */
async function createOrder(
  userId: string,
  total: number,
  overrides: { status?: string; paymentStatus?: string } = {},
): Promise<string> {
  const orderNumber = testOrderNumber();

  await prisma.order.create({
    data: {
      orderNumber,
      userId,
      subtotal: total,
      total,
      status: (overrides.status ?? 'DELIVERED') as 'DELIVERED',
      paymentStatus: (overrides.paymentStatus ?? 'PAID') as 'PAID',
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ', province: 'กรุงเทพมหานคร' },
    },
  });
  createdOrderNumbers.push(orderNumber);

  return orderNumber;
}

const ADDRESS_BODY = {
  label: 'บ้าน',
  recipientName: 'สมชาย ทดสอบ',
  phone: '0812345678',
  line1: '99/1 ซอยทดสอบ',
  subDistrict: 'คลองตัน',
  district: 'วัฒนา',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

beforeAll(async () => {
  customer = await createTestUser('CUSTOMER', 'main');
  otherCustomer = await createTestUser('CUSTOMER', 'other');
  employee = await createTestUser('EMPLOYEE', 'employee');
  admin = await createTestUser('ADMIN', 'admin');
  secondAdmin = await createTestUser('ADMIN', 'admin2');
  superAdmin = await createTestUser('SUPER_ADMIN', 'super');
});

afterAll(async () => {
  if (createdOrderNumbers.length > 0) {
    await prisma.order.deleteMany({ where: { orderNumber: { in: createdOrderNumbers } } });
  }

  if (createdUserIds.length > 0) {
    await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.adminLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.adminLog.deleteMany({
      where: { targetType: 'User', targetId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await disconnectDatabase();
});

describe('GET /api/users/me/profile', () => {
  it('ยังไม่ล็อกอิน → 401', async () => {
    const response = await request(app).get('/api/users/me/profile');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('คืนข้อมูลของตัวเอง และไม่มีข้อมูลภายในหลุดออกมา', async () => {
    const response = await request(app).get('/api/users/me/profile').set(auth(customer.token));

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(customer.id);
    expect(response.body.data.email).toBe(customer.email);
    expect(response.body.data.role).toBe('CUSTOMER');

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('deletedAt');
    expect(raw).not.toContain('roleId');
  });
});

describe('PATCH /api/users/me/profile', () => {
  it('แก้ชื่อ เบอร์โทร และวันเกิดได้ โดยวันเกิดไม่เลื่อนวัน', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ name: 'สมหญิง ใจดี', phone: '098-765-4321', birthDate: '2008-01-01' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('สมหญิง ใจดี');
    expect(response.body.data.phone).toBe('098-765-4321');
    // ค่าที่ส่งกลับต้องเป็นวันเดียวกับที่กรอก ไม่ใช่ 2007-12-31 จากการแปลงโซนเวลา
    expect(response.body.data.birthDate).toBe('2008-01-01');

    const again = await request(app).get('/api/users/me/profile').set(auth(customer.token));
    expect(again.body.data.birthDate).toBe('2008-01-01');
  });

  it('ล้างวันเกิดและเบอร์โทรด้วย null ได้', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ birthDate: null, phone: null });

    expect(response.status).toBe(200);
    expect(response.body.data.birthDate).toBeNull();
    expect(response.body.data.phone).toBeNull();
  });

  it('ปิดการแนะนำแบบ personalized ได้', async () => {
    const off = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ allowPersonalization: false });

    expect(off.status).toBe(200);
    expect(off.body.data.allowPersonalization).toBe(false);

    const on = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ allowPersonalization: true });

    expect(on.body.data.allowPersonalization).toBe(true);
  });

  it('เมินฟิลด์ที่ลูกค้าตั้งเองไม่ได้ (email · role · status · points · loyaltyTier)', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({
        name: 'ชื่อที่แก้ได้',
        email: 'hacker@evil.test',
        role: 'SUPER_ADMIN',
        status: 'BANNED',
        points: 999_999,
        loyaltyTier: 'VIP',
        totalSpent: 1_000_000,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('ชื่อที่แก้ได้');

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: customer.id },
      select: {
        email: true,
        status: true,
        points: true,
        loyaltyTier: true,
        totalSpent: true,
        role: { select: { name: true } },
      },
    });

    expect(row.email).toBe(customer.email);
    expect(row.status).toBe('ACTIVE');
    expect(row.points).toBe(0);
    expect(row.loyaltyTier).toBe('MEMBER');
    expect(Number(String(row.totalSpent))).toBe(0);
    expect(row.role.name).toBe('CUSTOMER');
  });

  it('วันเกิดในอนาคต → 422', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ birthDate: future });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('อนาคต');
  });

  it('วันที่ที่ไม่มีในปฏิทิน → 422 (ไม่ถูกเลื่อนให้เงียบ ๆ)', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ birthDate: '2010-02-31' });

    expect(response.status).toBe(422);
  });

  it('ไม่ส่งอะไรมาเลย → 422 ไม่ใช่การบันทึกที่ว่างเปล่า', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({});

    expect(response.status).toBe(422);
  });

  it('ไม่ส่งชื่อมาแล้วไม่ควรได้ข้อความ error ดิบภาษาอังกฤษ', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .send({ name: 123 });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain('expected string');
  });

  it('คำขอจากโดเมนอื่นถูกปฏิเสธ (CSRF)', async () => {
    const response = await request(app)
      .patch('/api/users/me/profile')
      .set(auth(customer.token))
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'ถูกแฮก' });

    expect(response.status).toBe(403);
  });
});

describe('สมุดที่อยู่ /api/users/me/addresses', () => {
  let firstAddressId = '';
  let secondAddressId = '';

  it('ที่อยู่แรกของบัญชีเป็นค่าเริ่มต้นให้เอง', async () => {
    const response = await request(app)
      .post('/api/users/me/addresses')
      .set(auth(customer.token))
      .send(ADDRESS_BODY);

    expect(response.status).toBe(201);
    expect(response.body.data.isDefault).toBe(true);
    expect(response.body.data.country).toBe('TH');
    firstAddressId = response.body.data.id;
  });

  it('ที่อยู่ถัดไปไม่แย่งค่าเริ่มต้นถ้าไม่ได้สั่ง', async () => {
    const response = await request(app)
      .post('/api/users/me/addresses')
      .set(auth(customer.token))
      .send({ ...ADDRESS_BODY, label: 'ที่ทำงาน', line1: '1 อาคารทดสอบ' });

    expect(response.status).toBe(201);
    expect(response.body.data.isDefault).toBe(false);
    secondAddressId = response.body.data.id;
  });

  it('ตั้งค่าเริ่มต้นใหม่แล้วอันเดิมถูกปลด — เหลือค่าเริ่มต้นอันเดียวเสมอ', async () => {
    const response = await request(app)
      .patch(`/api/users/me/addresses/${secondAddressId}/default`)
      .set(auth(customer.token));

    expect(response.status).toBe(200);
    expect(response.body.data.isDefault).toBe(true);

    const defaults = await prisma.address.count({
      where: { userId: customer.id, deletedAt: null, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it('กดตั้งค่าเริ่มต้นซ้ำไม่ error (idempotent)', async () => {
    const response = await request(app)
      .patch(`/api/users/me/addresses/${secondAddressId}/default`)
      .set(auth(customer.token));

    expect(response.status).toBe(200);
    expect(response.body.data.isDefault).toBe(true);
  });

  it('ปลดค่าเริ่มต้นด้วย isDefault: false ไม่ได้ (ต้องตั้งอันอื่นแทน)', async () => {
    const response = await request(app)
      .patch(`/api/users/me/addresses/${secondAddressId}`)
      .set(auth(customer.token))
      .send({ isDefault: false });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('ที่อยู่เริ่มต้น');
  });

  it('แก้เฉพาะช่องที่ส่งมา ช่องอื่นไม่ถูกล้าง', async () => {
    const response = await request(app)
      .patch(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(customer.token))
      .send({ recipientName: 'สมชาย แก้ชื่อ' });

    expect(response.status).toBe(200);
    expect(response.body.data.recipientName).toBe('สมชาย แก้ชื่อ');
    expect(response.body.data.province).toBe(ADDRESS_BODY.province);
    expect(response.body.data.postalCode).toBe(ADDRESS_BODY.postalCode);
    expect(response.body.data.label).toBe('บ้าน');
  });

  it('รหัสไปรษณีย์ที่ไม่ใช่เลข 5 หลัก → 422', async () => {
    const response = await request(app)
      .patch(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(customer.token))
      .send({ postalCode: '1011' });

    expect(response.status).toBe(422);
  });

  it('ที่อยู่ของคนอื่นแก้ ลบ หรือตั้งเป็นค่าเริ่มต้นไม่ได้ — และได้ 404 ไม่ใช่ 403', async () => {
    const patch = await request(app)
      .patch(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(otherCustomer.token))
      .send({ recipientName: 'ถูกแฮก' });
    expect(patch.status).toBe(404);

    const setDefault = await request(app)
      .patch(`/api/users/me/addresses/${firstAddressId}/default`)
      .set(auth(otherCustomer.token));
    expect(setDefault.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(otherCustomer.token));
    expect(remove.status).toBe(404);

    // ของจริงต้องไม่ถูกแตะ
    const row = await prisma.address.findUniqueOrThrow({ where: { id: firstAddressId } });
    expect(row.recipientName).toBe('สมชาย แก้ชื่อ');
    expect(row.deletedAt).toBeNull();
  });

  it('รายการที่อยู่ของแต่ละคนแยกกัน', async () => {
    const mine = await request(app).get('/api/users/me/addresses').set(auth(customer.token));
    const theirs = await request(app).get('/api/users/me/addresses').set(auth(otherCustomer.token));

    expect(mine.body.data.total).toBe(2);
    expect(theirs.body.data.total).toBe(0);
    // ที่อยู่เริ่มต้นมาก่อนเสมอ
    expect(mine.body.data.items[0].isDefault).toBe(true);
  });

  it('แก้ที่อยู่ไม่เปลี่ยนปลายทางของคำสั่งซื้อที่สั่งไปแล้ว (ใช้ snapshot)', async () => {
    const orderNumber = testOrderNumber();
    await prisma.order.create({
      data: {
        orderNumber,
        userId: customer.id,
        subtotal: 500,
        total: 500,
        status: 'PACKING',
        paymentStatus: 'PAID',
        shippingAddressId: firstAddressId,
        addressSnapshot: { recipientName: 'ชื่อตอนสั่ง', province: 'กรุงเทพมหานคร' },
      },
    });
    createdOrderNumbers.push(orderNumber);

    await request(app)
      .patch(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(customer.token))
      .send({ recipientName: 'ชื่อใหม่หลังสั่ง', province: 'เชียงใหม่' })
      .expect(200);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { addressSnapshot: true },
    });

    expect(order.addressSnapshot).toEqual({
      recipientName: 'ชื่อตอนสั่ง',
      province: 'กรุงเทพมหานคร',
    });
  });

  it('ลบที่อยู่เป็น soft delete และคำสั่งซื้อที่อ้างถึงยังอยู่', async () => {
    const response = await request(app)
      .delete(`/api/users/me/addresses/${firstAddressId}`)
      .set(auth(customer.token));

    expect(response.status).toBe(200);

    const row = await prisma.address.findUniqueOrThrow({ where: { id: firstAddressId } });
    expect(row.deletedAt).not.toBeNull();

    const stillLinked = await prisma.order.count({
      where: { shippingAddressId: firstAddressId },
    });
    expect(stillLinked).toBeGreaterThan(0);

    const list = await request(app).get('/api/users/me/addresses').set(auth(customer.token));
    expect(list.body.data.total).toBe(1);
  });

  it('ลบที่อยู่เริ่มต้นแล้วเลื่อนอันอื่นขึ้นมาเป็นค่าเริ่มต้น', async () => {
    const extra = await request(app)
      .post('/api/users/me/addresses')
      .set(auth(customer.token))
      .send({ ...ADDRESS_BODY, label: 'หอพัก', line1: '7 หอทดสอบ' });
    const extraId = extra.body.data.id;

    // secondAddressId เป็นค่าเริ่มต้นอยู่ — ลบแล้วต้องมีอันใหม่ขึ้นแทน
    const response = await request(app)
      .delete(`/api/users/me/addresses/${secondAddressId}`)
      .set(auth(customer.token));

    expect(response.status).toBe(200);
    expect(response.body.data.newDefaultAddressId).toBe(extraId);

    const defaults = await prisma.address.count({
      where: { userId: customer.id, deletedAt: null, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it('ลบที่อยู่เดิมซ้ำ → 404 (ที่ถูกลบแล้วมองไม่เห็นอีก)', async () => {
    const response = await request(app)
      .delete(`/api/users/me/addresses/${secondAddressId}`)
      .set(auth(customer.token));

    expect(response.status).toBe(404);
  });

  it('เก็บที่อยู่เกินเพดานไม่ได้ → 409', async () => {
    const current = await prisma.address.count({
      where: { userId: otherCustomer.id, deletedAt: null },
    });

    for (let index = current; index < 20; index += 1) {
      await request(app)
        .post('/api/users/me/addresses')
        .set(auth(otherCustomer.token))
        .send({ ...ADDRESS_BODY, label: `ที่ ${index}` })
        .expect(201);
    }

    const response = await request(app)
      .post('/api/users/me/addresses')
      .set(auth(otherCustomer.token))
      .send({ ...ADDRESS_BODY, label: 'เกินเพดาน' });

    expect(response.status).toBe(409);
  });
});

describe('GET /api/admin/customers', () => {
  it('ลูกค้าทั่วไปเข้าไม่ได้ (ไม่มีสิทธิ์ customer:read)', async () => {
    const response = await request(app).get('/api/admin/customers').set(auth(customer.token));

    expect(response.status).toBe(403);
  });

  it('พนักงานดูรายการได้ และตัวเลขสรุปนับทั้งระบบ', async () => {
    const response = await request(app).get('/api/admin/customers').set(auth(employee.token));

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data.items)).toBe(true);
    expect(response.body.data.counts.customers).toBeGreaterThan(0);
    expect(response.body.data.counts.staff).toBeGreaterThan(0);
  });

  it('ค้นหาด้วยอีเมลเจอคนที่ต้องการ', async () => {
    const response = await request(app)
      .get(`/api/admin/customers?q=${encodeURIComponent(customer.email)}`)
      .set(auth(employee.token));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(customer.id);
  });

  it('กรองตามบทบาทได้ และผลลัพธ์มีแต่บทบาทนั้น', async () => {
    const response = await request(app)
      .get('/api/admin/customers?role=SUPER_ADMIN&limit=50')
      .set(auth(employee.token));

    expect(response.status).toBe(200);
    for (const item of response.body.data.items) {
      expect(item.role).toBe('SUPER_ADMIN');
    }
  });

  it('ยอดซื้อนับจากตาราง Order จริง ไม่ใช่คอลัมน์ cache User.totalSpent', async () => {
    await createOrder(customer.id, 1_200);
    await createOrder(customer.id, 800);
    // ออเดอร์ที่ยกเลิกต้องไม่ถูกนับเป็นยอดขาย
    await createOrder(customer.id, 5_000, { status: 'CANCELLED', paymentStatus: 'CANCELLED' });
    // COD ที่ยังไม่เก็บเงินต้องแยกออกจากยอดที่ได้รับ
    await createOrder(customer.id, 300, { status: 'SHIPPING', paymentStatus: 'PENDING' });

    // ใส่ค่าหลอกไว้ในคอลัมน์ cache — ถ้าโค้ดอ่านคอลัมน์นี้ เทสต์จะจับได้ทันที
    await prisma.user.update({ where: { id: customer.id }, data: { totalSpent: 999_999 } });

    const response = await request(app)
      .get(`/api/admin/customers?q=${encodeURIComponent(customer.email)}`)
      .set(auth(employee.token));

    const item = response.body.data.items[0];
    // 1,200 + 800 + 500 (ออเดอร์ของเทสต์ที่อยู่ ซึ่งเป็น PACKING/PAID) = 2,500
    // ออเดอร์ที่ยกเลิก (5,000) และ COD ที่ยังไม่เก็บเงิน (300) ต้องไม่อยู่ในยอดนี้
    expect(item.stats.totalPaid).toBe(2_500);
    expect(item.stats.paidOrders).toBe(3);
    expect(item.stats.totalOrders).toBe(5);
    expect(item.stats.pendingCodAmount).toBe(300);
    expect(item.stats.lastOrderAt).not.toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('999999');

    await prisma.user.update({ where: { id: customer.id }, data: { totalSpent: 0 } });
  });
});

describe('GET /api/admin/customers/:userId', () => {
  it('คืนที่อยู่ คำสั่งซื้อล่าสุด และจำนวน session ที่ยังใช้ได้', async () => {
    const response = await request(app)
      .get(`/api/admin/customers/${customer.id}`)
      .set(auth(employee.token));

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(customer.id);
    expect(Array.isArray(response.body.data.addresses)).toBe(true);
    expect(response.body.data.recentOrders.length).toBeGreaterThan(0);
    expect(response.body.data.activeSessions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('id ที่ไม่มีจริง → 404', async () => {
    const response = await request(app)
      .get(`/api/admin/customers/${randomUUID()}`)
      .set(auth(employee.token));

    expect(response.status).toBe(404);
  });

  it('userId ที่ไม่ใช่ UUID → 422', async () => {
    const response = await request(app)
      .get('/api/admin/customers/not-a-uuid')
      .set(auth(employee.token));

    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/admin/customers/:userId/status', () => {
  it('พนักงานระงับบัญชีไม่ได้ (ต้องมี customer:update)', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${customer.id}/status`)
      .set(auth(employee.token))
      .send({ status: 'SUSPENDED', reason: 'ทดสอบสิทธิ์' });

    expect(response.status).toBe(403);
  });

  it('ไม่กรอกเหตุผล → 422', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${customer.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'SUSPENDED' });

    expect(response.status).toBe(422);
  });

  it('ระงับบัญชีตัวเองไม่ได้ → 400', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${admin.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'SUSPENDED', reason: 'ลองระงับตัวเอง' });

    expect(response.status).toBe(400);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.status).toBe('ACTIVE');
  });

  it('ADMIN ระงับ ADMIN อีกคนไม่ได้ → 403', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${secondAdmin.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'SUSPENDED', reason: 'ลองระงับคนระดับเดียวกัน' });

    expect(response.status).toBe(403);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: secondAdmin.id } });
    expect(row.status).toBe('ACTIVE');
  });

  it('ระงับลูกค้าแล้ว session ถูกเพิกถอนทันที + เขียน AdminLog พร้อมเหตุผล', async () => {
    const target = await createTestUser('CUSTOMER', 'suspend');

    // ก่อนระงับ ใช้งานได้ปกติ
    await request(app).get('/api/users/me/profile').set(auth(target.token)).expect(200);

    const response = await request(app)
      .patch(`/api/admin/customers/${target.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'SUSPENDED', reason: 'สั่งของแล้วไม่รับสาย 3 ครั้ง' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUSPENDED');
    expect(response.body.data.activeSessions).toBe(0);

    // token เดิมใช้ต่อไม่ได้แล้ว
    await request(app).get('/api/users/me/profile').set(auth(target.token)).expect(401);

    const sessions = await prisma.session.count({ where: { userId: target.id } });
    expect(sessions).toBe(0);

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'customer.status.update', targetId: target.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.userId).toBe(admin.id);
    expect(JSON.stringify(log.after)).toContain('ไม่รับสาย');
    expect(JSON.stringify(log.before)).toContain('ACTIVE');
  });

  it('ตั้งสถานะเดิมซ้ำ → 409', async () => {
    const target = await createTestUser('CUSTOMER', 'samestatus');

    const response = await request(app)
      .patch(`/api/admin/customers/${target.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'ACTIVE', reason: 'อยู่สถานะนี้แล้ว' });

    expect(response.status).toBe(409);
  });

  it('ปลดระงับได้ และไม่ไปลบ session ของบัญชีที่กลับมาใช้งาน', async () => {
    const target = await createTestUser('CUSTOMER', 'unsuspend');

    await request(app)
      .patch(`/api/admin/customers/${target.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'SUSPENDED', reason: 'ระงับก่อนเพื่อทดสอบ' })
      .expect(200);

    // ล็อกอินใหม่ (session ใหม่) แล้วค่อยปลดระงับ
    const freshToken = `test-session-${randomUUID()}`;
    await prisma.session.create({
      data: {
        sessionToken: freshToken,
        userId: target.id,
        expires: new Date(Date.now() + 3_600_000),
      },
    });

    const response = await request(app)
      .patch(`/api/admin/customers/${target.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'ACTIVE', reason: 'ติดต่อได้แล้ว' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(response.body.data.activeSessions).toBe(1);

    await request(app).get('/api/users/me/profile').set(auth(freshToken)).expect(200);
  });
});

describe('PATCH /api/admin/customers/:userId/role', () => {
  it('ADMIN ไม่มีสิทธิ์ user:role:manage → 403', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${customer.id}/role`)
      .set(auth(admin.token))
      .send({ role: 'EMPLOYEE', reason: 'ลองเปลี่ยนบทบาท' });

    expect(response.status).toBe(403);
  });

  it('เปลี่ยนบทบาทตัวเองไม่ได้ → 400', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${superAdmin.id}/role`)
      .set(auth(superAdmin.token))
      .send({ role: 'CUSTOMER', reason: 'ลองลดบทบาทตัวเอง' });

    expect(response.status).toBe(400);
  });

  it('บทบาทเดิมซ้ำ → 409', async () => {
    const response = await request(app)
      .patch(`/api/admin/customers/${admin.id}/role`)
      .set(auth(superAdmin.token))
      .send({ role: 'ADMIN', reason: 'บทบาทเดิม' });

    expect(response.status).toBe(409);
  });

  it('เลื่อนเป็นพนักงานแล้วสิทธิ์มีผลทันทีโดยไม่ต้องล็อกอินใหม่', async () => {
    const target = await createTestUser('CUSTOMER', 'promote');

    // ยังเป็นลูกค้า — เปิดหลังบ้านไม่ได้
    await request(app).get('/api/admin/customers').set(auth(target.token)).expect(403);

    const response = await request(app)
      .patch(`/api/admin/customers/${target.id}/role`)
      .set(auth(superAdmin.token))
      .send({ role: 'EMPLOYEE', reason: 'เริ่มงานวันนี้' });

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('EMPLOYEE');

    // token เดิมยังใช้ได้ และได้สิทธิ์ใหม่ทันที (สิทธิ์อ่านจากฐานข้อมูลทุกคำขอ)
    await request(app).get('/api/admin/customers').set(auth(target.token)).expect(200);

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'customer.role.update', targetId: target.id },
    });
    expect(JSON.stringify(log.before)).toContain('CUSTOMER');
    expect(JSON.stringify(log.after)).toContain('EMPLOYEE');
  });

  it('ADMIN ที่ได้สิทธิ์ user:role:manage ก็ยังตั้งบทบาท ADMIN ให้ใครไม่ได้', async () => {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'user:role:manage' },
    });

    // ให้สิทธิ์ชั่วคราวเพื่อพิสูจน์ว่าด่านที่กันการยกระดับสิทธิ์อยู่ใน service ไม่ใช่แค่ middleware
    await prisma.role.update({
      where: { id: roleRow.id },
      data: { permissions: { connect: { id: permission.id } } },
    });

    try {
      const target = await createTestUser('CUSTOMER', 'escalate');

      const tooHigh = await request(app)
        .patch(`/api/admin/customers/${target.id}/role`)
        .set(auth(admin.token))
        .send({ role: 'ADMIN', reason: 'ลองยกระดับให้เท่าตัวเอง' });

      expect(tooHigh.status).toBe(403);

      const stillCustomer = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { role: { select: { name: true } } },
      });
      expect(stillCustomer.role.name).toBe('CUSTOMER');

      // ต่ำกว่าตัวเองตั้งได้
      const allowed = await request(app)
        .patch(`/api/admin/customers/${target.id}/role`)
        .set(auth(admin.token))
        .send({ role: 'EMPLOYEE', reason: 'รับเข้าทำงาน' });

      expect(allowed.status).toBe(200);
    } finally {
      await prisma.role.update({
        where: { id: roleRow.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });
    }
  });
});
