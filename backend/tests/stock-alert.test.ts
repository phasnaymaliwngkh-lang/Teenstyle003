import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของการแจ้งเตือนสต็อก (STEP 16)
 *
 * สิ่งที่ต้องพิสูจน์
 *   - รายการเตือนคำนวณสดจากฐานข้อมูล (ของกลับมาเต็ม = หายจากรายการทันที)
 *   - แจ้งครั้งเดียวต่อปัญหาหนึ่งเรื่อง (ไม่ยิงซ้ำทุกครั้งที่ตรวจ)
 *   - **แย่ลงต้องเตือนใหม่** (เหลือน้อย → หมด) · **ดีขึ้นไม่ต้องเตือน** (หมด → เหลือน้อย)
 *   - ของกลับมาปกติ → ระบบปิดการเตือนเดิมให้เอง
 *   - **เตือนเฉพาะของที่ขายอยู่จริง** (ฉบับร่าง/ตัวเลือกที่ปิดขาย ต้องไม่โผล่)
 *   - **ของที่ถูกจองจนหมดต้องเตือน** เพราะขายต่อไม่ได้แล้วจริง
 *   - ปรับสต็อกแล้วระบบตรวจเตือนให้เองทันที (ไม่ต้องกดปุ่มตรวจ)
 *   - ช่องทางอีเมลที่ยังไม่ได้ตั้งค่าต้องถูกปิดและบอกเหตุผล ไม่สร้างแถวปลอม
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let staff = { id: '', token: '' };
let customer = { id: '', token: '' };

let productId = '';
let variantId = '';
let productName = '';
const MINIMUM_STOCK = 5;
const INITIAL_STOCK = 20;

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-alert-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

function asStaff() {
  return { Authorization: `Bearer ${staff.token}` };
}

async function createTestProduct(status: 'ACTIVE' | 'DRAFT' = 'ACTIVE') {
  const unique = randomUUID().slice(0, 6);
  const res = await request(app)
    .post('/api/admin/products')
    .set(asStaff())
    .send({
      name: `สินค้าทดสอบแจ้งเตือน ${unique}`,
      slug: `test-alert-${unique}`,
      sku: `TS-ALERT-${unique.toUpperCase()}`,
      description: 'สินค้าทดสอบระบบแจ้งเตือนสต็อกที่มีคำอธิบายยาวพอสำหรับ validation',
      price: 400,
      categorySlug: 'tops',
      status,
      minimumStock: MINIMUM_STOCK,
      images: [
        {
          url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
          alt: 'รูปสินค้าทดสอบ',
          isMain: true,
          sortOrder: 0,
        },
      ],
      variants: [
        {
          sku: `TS-ALERT-${unique.toUpperCase()}-BLA-M`,
          colorSlug: 'black',
          sizeCode: 'M',
          initialStock: INITIAL_STOCK,
          isActive: true,
        },
      ],
    });

  if (res.status !== 201) {
    throw new Error(`สร้างสินค้าทดสอบไม่สำเร็จ: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    productId: res.body.data.id as string,
    productName: res.body.data.name as string,
    variantId: res.body.data.variants[0].id as string,
  };
}

/** ตั้งยอดในคลังตรง ๆ เพื่อจัดฉากทดสอบ (ไม่ผ่าน API เพราะกำลังทดสอบตัวแจ้งเตือน ไม่ใช่การปรับสต็อก) */
async function setStock(quantity: number, reserved = 0) {
  await prisma.inventory.update({
    where: { variantId },
    data: { quantity, reservedQuantity: reserved },
  });
  await prisma.product.update({ where: { id: productId }, data: { totalStock: quantity } });
}

function scan() {
  return request(app).post('/api/admin/stock-alerts/scan').set(asStaff()).send({});
}

function listAlerts(query = '') {
  return request(app).get(`/api/admin/stock-alerts${query}`).set(asStaff());
}

/** การแจ้งเตือนของตัวเลือกนี้ที่ยังเปิดอยู่ */
async function openNotifications() {
  const rows = await prisma.notification.findMany({
    where: { type: 'LOW_STOCK', readAt: null },
    select: { id: true, title: true, body: true, data: true, channel: true, status: true },
  });

  return rows.filter(
    (row) =>
      typeof row.data === 'object' &&
      row.data !== null &&
      !Array.isArray(row.data) &&
      (row.data as Record<string, unknown>)['variantId'] === variantId,
  );
}

async function allNotificationsForVariant() {
  const rows = await prisma.notification.findMany({
    where: { type: 'LOW_STOCK' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, readAt: true, data: true },
  });

  return rows.filter(
    (row) =>
      typeof row.data === 'object' &&
      row.data !== null &&
      !Array.isArray(row.data) &&
      (row.data as Record<string, unknown>)['variantId'] === variantId,
  );
}

beforeAll(async () => {
  staff = await createUser('ADMIN', 'staff');
  customer = await createUser('CUSTOMER', 'cust');

  const created = await createTestProduct();
  productId = created.productId;
  productName = created.productName;
  variantId = created.variantId;
});

// เริ่มทุกเคสด้วยของเต็มคลังและไม่มีการเตือนค้าง
beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { type: 'LOW_STOCK' } });
  await setStock(INITIAL_STOCK, 0);
});

afterAll(async () => {
  const userIds = [staff.id, customer.id];

  await prisma.notification.deleteMany({ where: { type: 'LOW_STOCK' } });
  await prisma.inventoryMovement.deleteMany({ where: { variant: { productId } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await disconnectDatabase();
});

describe('RBAC', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้า → 403', async () => {
    const anonymous = await request(app).get('/api/admin/stock-alerts');
    const asShopper = await request(app)
      .get('/api/admin/stock-alerts')
      .set({ Authorization: `Bearer ${customer.token}` });

    expect(anonymous.status).toBe(401);
    expect(asShopper.status).toBe(403);
  });
});

describe('รายการเตือนคำนวณสดจากฐานข้อมูล', () => {
  it('ของเต็มคลัง → ไม่อยู่ในรายการเตือน', async () => {
    const res = await listAlerts();

    expect(res.status).toBe(200);
    const found = (res.body.data.items as { variantId: string }[]).find(
      (item) => item.variantId === variantId,
    );
    expect(found).toBeUndefined();
  });

  it('เหลือน้อยกว่าจุดเตือน → เข้ารายการเป็น LOW_STOCK พร้อมตัวเลขจริง', async () => {
    await setStock(3);

    const res = await listAlerts();
    const found = (
      res.body.data.items as {
        variantId: string;
        severity: string;
        available: number;
        minimumStock: number;
      }[]
    ).find((item) => item.variantId === variantId);

    expect(found?.severity).toBe('LOW_STOCK');
    expect(found?.available).toBe(3);
    expect(found?.minimumStock).toBe(MINIMUM_STOCK);
  });

  it('ของหมด → เข้ารายการเป็น OUT_OF_STOCK', async () => {
    await setStock(0);

    const res = await listAlerts();
    const found = (res.body.data.items as { variantId: string; severity: string }[]).find(
      (item) => item.variantId === variantId,
    );

    expect(found?.severity).toBe('OUT_OF_STOCK');
  });

  it('ของอยู่ในคลังแต่ถูกจองจนหมด → ต้องเตือนว่าหมด (ขายต่อไม่ได้จริง)', async () => {
    await setStock(INITIAL_STOCK, INITIAL_STOCK);

    const res = await listAlerts();
    const found = (
      res.body.data.items as {
        variantId: string;
        severity: string;
        quantity: number;
        reserved: number;
        available: number;
      }[]
    ).find((item) => item.variantId === variantId);

    expect(found?.severity).toBe('OUT_OF_STOCK');
    expect(found?.quantity).toBe(INITIAL_STOCK); // ของยังอยู่ในคลัง
    expect(found?.reserved).toBe(INITIAL_STOCK);
    expect(found?.available).toBe(0); // แต่ขายไม่ได้
  });

  it('กรองตามความรุนแรงได้ และทุกแถวตรงเงื่อนไขจริง', async () => {
    await setStock(0);

    const out = await listAlerts('?severity=OUT_OF_STOCK');
    for (const item of out.body.data.items as { available: number }[]) {
      expect(item.available).toBe(0);
    }

    const low = await listAlerts('?severity=LOW_STOCK');
    for (const item of low.body.data.items as { available: number; minimumStock: number }[]) {
      expect(item.available).toBeGreaterThan(0);
      expect(item.available).toBeLessThanOrEqual(item.minimumStock);
    }
  });

  it('ค่าความรุนแรงที่ไม่มีใน enum → 422', async () => {
    const res = await listAlerts('?severity=SOMETHING');

    expect(res.status).toBe(422);
  });
});

describe('การแจ้งเตือน (ไม่ซ้ำ · แย่ลงเตือนใหม่ · ดีขึ้นปิดเอง)', () => {
  it('ตกเกณฑ์แล้วตรวจ → แจ้ง 1 รายการ พร้อมตัวเลขจริงในข้อความ', async () => {
    await setStock(2);

    const res = await scan();

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);

    const open = await openNotifications();
    expect(open.length).toBe(1);
    expect(open[0]!.channel).toBe('IN_APP');
    expect(open[0]!.status).toBe('SENT');
    expect(open[0]!.title).toContain(productName);
    expect(open[0]!.body).toContain('2'); // เหลือขายได้ 2 ชิ้น
    expect(open[0]!.body).toContain(String(MINIMUM_STOCK));
  });

  it('ตรวจซ้ำโดยสถานะไม่เปลี่ยน → ไม่แจ้งซ้ำ', async () => {
    await setStock(2);
    await scan();

    const second = await scan();

    expect(second.body.data.created).toBe(0);
    expect(second.body.data.escalated).toBe(0);
    expect((await openNotifications()).length).toBe(1);
  });

  it('เหลือน้อย → หมด (แย่ลง) → เตือนใหม่และปิดรายการเดิม', async () => {
    await setStock(2);
    await scan();

    await setStock(0);
    const res = await scan();

    expect(res.body.data.escalated).toBe(1);

    const open = await openNotifications();
    expect(open.length).toBe(1);
    expect(open[0]!.title).toContain('สินค้าหมด');

    // รายการเดิมถูกปิดโดยระบบ พร้อมเหตุผล
    const all = await allNotificationsForVariant();
    expect(all.length).toBe(2);
    const closed = all.find((row) => row.readAt !== null);
    expect(JSON.stringify(closed?.data)).toContain('system');
  });

  it('หมด → เหลือน้อย (ดีขึ้น) → ไม่เตือนใหม่', async () => {
    await setStock(0);
    await scan();

    await setStock(3);
    const res = await scan();

    expect(res.body.data.created).toBe(0);
    expect(res.body.data.escalated).toBe(0);
    expect((await allNotificationsForVariant()).length).toBe(1);
  });

  it('ของกลับมาเหนือจุดเตือน → ระบบปิดการเตือนให้เอง และเตือนใหม่ได้ถ้าตกอีก', async () => {
    await setStock(1);
    await scan();
    expect((await openNotifications()).length).toBe(1);

    await setStock(50);
    const recovered = await scan();

    expect(recovered.body.data.resolved).toBe(1);
    expect((await openNotifications()).length).toBe(0);

    const closed = (await allNotificationsForVariant())[0];
    expect(JSON.stringify(closed?.data)).toContain('สต็อกกลับมาอยู่เหนือจุดเตือนแล้ว');

    // ตกเกณฑ์อีกครั้ง → ต้องเตือนได้ใหม่ (ไม่ถูกกุญแจกันซ้ำของรอบก่อนบล็อก)
    await setStock(1);
    const again = await scan();
    expect(again.body.data.created).toBe(1);
  });
});

describe('เตือนเฉพาะของที่ขายอยู่จริง', () => {
  it('สินค้าฉบับร่างที่ของหมด → ไม่เตือน (ยังไม่ได้ขาย)', async () => {
    await setStock(0);
    await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ status: 'DRAFT' });

    try {
      const res = await scan();
      expect(res.body.data.created).toBe(0);
      expect((await openNotifications()).length).toBe(0);

      const list = await listAlerts();
      const found = (list.body.data.items as { variantId: string }[]).find(
        (item) => item.variantId === variantId,
      );
      expect(found).toBeUndefined();
    } finally {
      await request(app)
        .patch(`/api/admin/products/${productId}`)
        .set(asStaff())
        .send({ status: 'ACTIVE' });
    }
  });

  it('ตัวเลือกที่ปิดขายแล้วของหมด → ไม่เตือน', async () => {
    await setStock(0);
    await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ isActive: false });

    try {
      const res = await scan();

      expect(res.body.data.created).toBe(0);
      expect((await openNotifications()).length).toBe(0);
    } finally {
      await request(app)
        .patch(`/api/admin/products/${productId}/variants/${variantId}`)
        .set(asStaff())
        .send({ isActive: true });
    }
  });
});

describe('ตรวจเตือนอัตโนมัติเมื่อสต็อกขยับ', () => {
  it('ปรับสต็อกลงจนตกเกณฑ์ → ระบบแจ้งเตือนเองโดยไม่ต้องกดตรวจ', async () => {
    const res = await request(app)
      .post(`/api/admin/inventory/${variantId}/adjust`)
      .set(asStaff())
      .send({
        type: 'ADJUSTMENT',
        countedQuantity: 1,
        reason: 'ตรวจนับพบของหายเกือบหมด',
      });

    expect(res.status).toBe(200);

    const open = await openNotifications();
    expect(open.length).toBe(1);
    expect(open[0]!.title).toContain('สต็อกเหลือน้อย');
  });

  it('รับของเข้าจนพ้นจุดเตือน → การเตือนถูกปิดเองโดยไม่ต้องกดตรวจ', async () => {
    await setStock(1);
    await scan();
    expect((await openNotifications()).length).toBe(1);

    const res = await request(app)
      .post(`/api/admin/inventory/${variantId}/adjust`)
      .set(asStaff())
      .send({ type: 'STOCK_IN', quantity: 50, reason: 'รับของเข้าเพิ่มจนพ้นจุดเตือน' });

    expect(res.status).toBe(200);
    expect((await openNotifications()).length).toBe(0);
  });
});

describe('รับทราบการแจ้งเตือน', () => {
  it('กดรับทราบ → ปิดรายการ แต่ยังอยู่ในรายการเตือนสด (ปัญหายังไม่ถูกแก้)', async () => {
    await setStock(2);
    await scan();

    const before = await listAlerts();
    const target = (
      before.body.data.items as { variantId: string; notification: { id: string } | null }[]
    ).find((item) => item.variantId === variantId);
    expect(target?.notification).not.toBeNull();

    const ack = await request(app)
      .patch(`/api/admin/stock-alerts/${target!.notification!.id}/ack`)
      .set(asStaff())
      .send({});

    expect(ack.status).toBe(200);
    expect((await openNotifications()).length).toBe(0);

    const after = await listAlerts();
    const stillThere = (
      after.body.data.items as { variantId: string; notification: { id: string } | null }[]
    ).find((item) => item.variantId === variantId);
    expect(stillThere).toBeDefined();
    expect(stillThere?.notification).toBeNull();
  });

  it('รับทราบซ้ำ → 409 · id ที่ไม่มีจริง → 404 · รูปแบบผิด → 422', async () => {
    await setStock(2);
    await scan();
    const open = await openNotifications();
    const id = open[0]!.id;

    const first = await request(app)
      .patch(`/api/admin/stock-alerts/${id}/ack`)
      .set(asStaff())
      .send({});
    const again = await request(app)
      .patch(`/api/admin/stock-alerts/${id}/ack`)
      .set(asStaff())
      .send({});
    const missing = await request(app)
      .patch('/api/admin/stock-alerts/00000000-0000-4000-8000-000000000000/ack')
      .set(asStaff())
      .send({});
    const malformed = await request(app)
      .patch('/api/admin/stock-alerts/not-a-uuid/ack')
      .set(asStaff())
      .send({});

    expect(first.status).toBe(200);
    expect(again.status).toBe(409);
    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(422);
  });
});

describe('ช่องทางแจ้งเตือน', () => {
  it('บอกตามจริงว่าช่องทางไหนใช้ได้ และอีเมลยังไม่ได้ตั้งค่าเพราะอะไร', async () => {
    const res = await listAlerts();

    const channels = res.body.data.channels as {
      code: string;
      available: boolean;
      unavailableReason: string | null;
    }[];

    const inApp = channels.find((channel) => channel.code === 'IN_APP');
    const email = channels.find((channel) => channel.code === 'EMAIL');

    expect(inApp?.available).toBe(true);
    // ไม่ได้ตั้งค่า SMTP ในเครื่องนี้ → ต้องปิดและบอกเหตุผล ไม่ใช่แกล้งว่าส่งได้
    expect(email?.available).toBe(false);
    expect(email?.unavailableReason).toContain('SMTP');
    expect(res.body.data.emailConfigured).toBe(false);
  });

  it('ไม่สร้างแถวแจ้งเตือนช่องทางอีเมลเลยเมื่อยังส่งไม่ได้', async () => {
    await setStock(0);
    await scan();

    const emailRows = await prisma.notification.count({
      where: { type: 'LOW_STOCK', channel: 'EMAIL' },
    });

    expect(emailRows).toBe(0);
  });
});
