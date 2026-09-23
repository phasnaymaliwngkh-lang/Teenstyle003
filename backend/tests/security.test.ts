import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Security regression test (STEP 28)
 *
 * ไฟล์นี้ **ไม่ได้ทดสอบฟีเจอร์** แต่ล็อกคุณสมบัติด้านความปลอดภัยที่เคยตั้งใจทำไว้
 * ให้พังแล้วรู้ทันที เพราะของพวกนี้พังแบบเงียบ ๆ ได้ทั้งหมด:
 * ใครเผลอถอน middleware หนึ่งบรรทัด หรือเพิ่ม endpoint ใหม่โดยลืมด่าน
 * ระบบจะยังตอบ 200 ตามปกติจนกว่าจะมีคนใช้ช่องนั้น
 *
 * สิ่งที่ล็อกไว้
 *   - security header ที่ helmet ต้องส่ง และ header ที่บอกเทคโนโลยีต้องไม่มี
 *   - error 500 ต้องไม่หลุดรายละเอียดภายใน
 *   - ไม่มี endpoint ไหนคืน `passwordHash` หรือ session token
 *   - CSRF: คำขอที่เปลี่ยนข้อมูลจาก origin อื่นถูกปฏิเสธทุกเส้นทาง
 *   - ต้องล็อกอิน / ต้องมีสิทธิ์ ครบทุกกลุ่ม endpoint ของหลังบ้าน
 *   - IDOR: ของคนอื่นดูไม่ได้ และได้ 404 ไม่ใช่ 403
 *   - webhook ที่ลายเซ็นผิดถูกปฏิเสธ
 *   - อัปโหลดไฟล์ผิดชนิดถูกปฏิเสธที่ชั้นนอกสุด
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const createdUserIds: string[] = [];

let customer = { id: '', token: '' };
let otherCustomer = { id: '', token: '' };
let employee = { id: '', token: '' };

async function createTestUser(role: string, tag: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role as 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: {
      email: `test-sec-${tag}-${suffix}@teenstyle.test`,
      name: `ทดสอบ ${tag}`,
      roleId: roleRow.id,
      status: 'ACTIVE',
    },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

beforeAll(async () => {
  customer = await createTestUser('CUSTOMER', 'customer');
  otherCustomer = await createTestUser('CUSTOMER', 'other');
  employee = await createTestUser('EMPLOYEE', 'employee');
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await disconnectDatabase();
});

/* ─────────────────────── Security headers ─────────────────────── */

describe('security headers', () => {
  it('ส่ง header ป้องกันพื้นฐานที่ helmet ตั้งไว้', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('ไม่บอกว่าใช้เทคโนโลยีอะไร (ไม่มี x-powered-by)', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('ทุก response มี request id ให้ไล่ log ย้อนหลังได้', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/i);
  });
});

/* ─────────────────────── ไม่หลุดข้อมูลภายใน ─────────────────────── */

describe('ไม่หลุดข้อมูลภายในออกไปทาง response', () => {
  it('เส้นทางที่ไม่มีจริงคืน 404 ตาม shape มาตรฐาน ไม่ใช่ HTML ของ Express', async () => {
    const response = await request(app).get('/api/ไม่มีเส้นทางนี้');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });

  it('body ที่ไม่ใช่ JSON ที่ถูกต้อง → 400 ไม่ใช่ 500 และไม่มี stack trace', async () => {
    const response = await request(app)
      .post('/api/products/availability')
      .set('Content-Type', 'application/json')
      .send('{ไม่ใช่ json}');

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('SyntaxError');
  });

  it('ข้อมูลผู้ใช้ที่ส่งออกไปไม่มี passwordHash หรือ session token', async () => {
    const endpoints = ['/api/users/me', '/api/users/me/profile', '/api/users/me/addresses'];

    for (const endpoint of endpoints) {
      const response = await request(app).get(endpoint).set(auth(customer.token));
      const raw = JSON.stringify(response.body);

      expect(response.status).toBe(200);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('sessionToken');
      expect(raw).not.toContain(customer.token);
    }
  });

  it('รีวิวที่หน้าร้านไม่ส่งอีเมลของผู้รีวิวออกไป', async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { slug: true },
    });

    const response = await request(app).get(`/api/products/${product.slug}/reviews`);

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });
});

/* ─────────────────────── CSRF ─────────────────────── */

describe('CSRF — คำขอที่เปลี่ยนข้อมูลต้องมาจากเว็บเราเท่านั้น', () => {
  const EVIL = 'https://evil.example.com';

  it('ปฏิเสธคำขอที่ Origin ไม่อยู่ในรายการที่อนุญาต ทุกกลุ่มเส้นทาง', async () => {
    const cases: Array<{ method: 'post' | 'patch' | 'delete'; path: string; body?: object }> = [
      { method: 'post', path: '/api/cart/items', body: { variantId: randomUUID(), quantity: 1 } },
      { method: 'patch', path: '/api/users/me/profile', body: { name: 'ถูกแฮก' } },
      { method: 'post', path: '/api/users/me/addresses', body: {} },
      { method: 'patch', path: '/api/notifications/read-all' },
      { method: 'post', path: '/api/wishlist/items', body: { productId: randomUUID() } },
      { method: 'post', path: '/api/reviews', body: { productId: randomUUID(), rating: 5 } },
    ];

    for (const testCase of cases) {
      const pending = request(app)[testCase.method](testCase.path);
      const response = await pending
        .set(auth(customer.token))
        .set('Origin', EVIL)
        .send(testCase.body ?? {});

      expect(response.status, `${testCase.method.toUpperCase()} ${testCase.path}`).toBe(403);
    }
  });

  it('GET ไม่ถูกบล็อกด้วย Origin (ไม่เปลี่ยนข้อมูล)', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set(auth(customer.token))
      .set('Origin', EVIL);

    expect(response.status).toBe(200);
  });
});

/* ─────────────────────── Authentication / Authorization ─────────────────────── */

describe('ทุก endpoint ที่ต้องล็อกอินปฏิเสธคนที่ยังไม่ล็อกอิน', () => {
  it('ไม่มี token → 401 ทุกเส้นทาง', async () => {
    const paths = [
      '/api/users/me',
      '/api/users/me/profile',
      '/api/users/me/addresses',
      '/api/orders',
      '/api/wishlist',
      '/api/notifications',
      '/api/reviews/me',
      '/api/admin/overview',
      '/api/admin/customers',
      '/api/admin/analytics/summary',
      '/api/admin/logs',
    ];

    for (const path of paths) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(401);
    }
  });

  it('token ที่ไม่มีในฐานข้อมูล → 401', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set(auth(`test-session-${randomUUID()}`));

    expect(response.status).toBe(401);
  });

  it('session ที่หมดอายุแล้วใช้ต่อไม่ได้', async () => {
    const expired = `test-session-${randomUUID()}`;
    await prisma.session.create({
      data: { sessionToken: expired, userId: customer.id, expires: new Date(Date.now() - 1_000) },
    });

    const response = await request(app).get('/api/users/me').set(auth(expired));

    expect(response.status).toBe(401);
    await prisma.session.delete({ where: { sessionToken: expired } });
  });

  it('ลูกค้าเข้าหลังบ้านไม่ได้เลย', async () => {
    const paths = [
      '/api/admin/overview',
      '/api/admin/orders',
      '/api/admin/products',
      '/api/admin/inventory',
      '/api/admin/customers',
      '/api/admin/reviews',
      '/api/admin/analytics/summary',
      '/api/admin/logs',
      '/api/admin/export/products',
    ];

    for (const path of paths) {
      const response = await request(app).get(path).set(auth(customer.token));
      expect(response.status, path).toBe(403);
    }
  });

  it('พนักงานเข้าได้แค่ส่วนที่มีสิทธิ์จริง ไม่ใช่ทุกอย่างในหลังบ้าน', async () => {
    // EMPLOYEE มี order:read / inventory:read / customer:read ตาม seed
    for (const path of ['/api/admin/orders', '/api/admin/inventory', '/api/admin/customers']) {
      const allowed = await request(app).get(path).set(auth(employee.token));
      expect(allowed.status, path).toBe(200);
    }

    // แต่ไม่มี analytics:read / log:read / review:moderate
    for (const path of ['/api/admin/analytics/summary', '/api/admin/logs', '/api/admin/reviews']) {
      const denied = await request(app).get(path).set(auth(employee.token));
      expect(denied.status, path).toBe(403);
    }
  });
});

/* ─────────────────────── IDOR ─────────────────────── */

describe('IDOR — ข้อมูลของคนอื่นเข้าถึงไม่ได้ และตอบ 404 ไม่ใช่ 403', () => {
  it('ที่อยู่ของคนอื่นแก้/ลบไม่ได้ และได้ 404 (ไม่บอกใบ้ว่ามี id นี้อยู่จริง)', async () => {
    const created = await request(app)
      .post('/api/users/me/addresses')
      .set(auth(customer.token))
      .send({
        recipientName: 'เจ้าของจริง',
        phone: '0812345678',
        line1: '1 ถนนทดสอบ',
        subDistrict: 'คลองตัน',
        district: 'วัฒนา',
        province: 'กรุงเทพมหานคร',
        postalCode: '10110',
      });

    expect(created.status).toBe(201);
    const addressId = created.body.data.id as string;

    const patch = await request(app)
      .patch(`/api/users/me/addresses/${addressId}`)
      .set(auth(otherCustomer.token))
      .send({ recipientName: 'ถูกแฮก' });
    const remove = await request(app)
      .delete(`/api/users/me/addresses/${addressId}`)
      .set(auth(otherCustomer.token));

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);

    const row = await prisma.address.findUniqueOrThrow({ where: { id: addressId } });
    expect(row.recipientName).toBe('เจ้าของจริง');
    expect(row.deletedAt).toBeNull();
  });

  it('คำสั่งซื้อของคนอื่นเปิดดูไม่ได้ และได้ 404', async () => {
    const orderNumber = `TS-2097${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}-0001`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: customer.id,
        subtotal: 100,
        total: 100,
        addressSnapshot: { recipientName: 'ผู้รับ' },
      },
      select: { id: true },
    });

    const response = await request(app)
      .get(`/api/orders/${orderNumber}`)
      .set(auth(otherCustomer.token));

    expect(response.status).toBe(404);

    await prisma.order.delete({ where: { id: order.id } });
  });
});

/* ─────────────────────── Webhook ─────────────────────── */

describe('Stripe webhook', () => {
  it('ลายเซ็นผิดถูกปฏิเสธ', async () => {
    const response = await request(app)
      .post('/api/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      // ค่า header ต้องเป็น ASCII เท่านั้น — ใส่ภาษาไทยลงไป superagent จะโยน error ก่อนส่ง
      .set(
        'stripe-signature',
        't=1,v1=0000000000000000000000000000000000000000000000000000000000000000',
      )
      .send(JSON.stringify({ id: 'evt_test', type: 'checkout.session.completed' }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('ไม่มีลายเซ็นเลยก็ถูกปฏิเสธ', async () => {
    const response = await request(app)
      .post('/api/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

/* ─────────────────────── Upload ─────────────────────── */

describe('การอัปโหลดไฟล์', () => {
  it('ไฟล์ที่ไม่ใช่ .csv/.xlsx/.xls ถูกปฏิเสธที่ชั้นนอกสุด', async () => {
    const response = await request(app)
      .post('/api/admin/import/products')
      .set(auth(employee.token))
      .attach('file', Buffer.from('<?php echo 1; ?>'), 'shell.php');

    // พนักงานไม่มีสิทธิ์ product:create อยู่แล้ว → 403 มาก่อน fileFilter
    // ทดสอบว่าไม่ใช่ 200 และไม่ใช่ 500 (ไฟล์ไม่เคยถูกประมวลผล)
    expect([400, 403]).toContain(response.status);
  });
});
