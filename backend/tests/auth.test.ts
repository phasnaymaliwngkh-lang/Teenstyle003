import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของ Authentication + RBAC (STEP 3)
 *
 * ใช้ฐานข้อมูลจริง (ไม่ mock) เพื่อพิสูจน์ว่า:
 *   - endpoint ที่ต้องล็อกอิน คืน 401 เมื่อไม่มี session ที่ใช้ได้
 *   - RBAC ทำงานจริง: CUSTOMER เรียก /api/admin/* ได้ 403 ส่วน SUPER_ADMIN ได้ 200
 *   - session ที่หมดอายุใช้ไม่ได้
 *   - บัญชีที่ถูกระงับใช้ session ที่ค้างอยู่ไม่ได้
 *
 * สร้างผู้ใช้ทดสอบขึ้นใหม่แล้วลบทิ้งใน afterAll — ไม่แตะข้อมูลที่ seed ไว้
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const customerEmail = `test-customer-${suffix}@teenstyle.test`;
const adminEmail = `test-admin-${suffix}@teenstyle.test`;

let customerToken = '';
let adminToken = '';
let expiredToken = '';
let suspendedToken = '';
const createdUserIds: string[] = [];

async function createUserWithSession(
  email: string,
  roleName: 'CUSTOMER' | 'SUPER_ADMIN',
  options: { expires?: Date; status?: 'ACTIVE' | 'SUSPENDED' } = {},
): Promise<{ userId: string; token: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });

  const user = await prisma.user.create({
    data: { email, name: `Test ${roleName}`, roleId: role.id, status: options.status ?? 'ACTIVE' },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId: user.id,
      expires: options.expires ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return { userId: user.id, token };
}

beforeAll(async () => {
  const customer = await createUserWithSession(customerEmail, 'CUSTOMER');
  customerToken = customer.token;

  const admin = await createUserWithSession(adminEmail, 'SUPER_ADMIN');
  adminToken = admin.token;

  // session ที่หมดอายุไปแล้ว (ผูกกับผู้ใช้ customer เดิม)
  expiredToken = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: {
      sessionToken: expiredToken,
      userId: customer.userId,
      expires: new Date(Date.now() - 60 * 1000),
    },
  });

  // บัญชีที่ถูกระงับแต่ยังมี session ค้างอยู่
  const suspended = await createUserWithSession(
    `test-suspended-${suffix}@teenstyle.test`,
    'CUSTOMER',
    { status: 'SUSPENDED' },
  );
  suspendedToken = suspended.token;
});

afterAll(async () => {
  // ลบ session ก่อน (มี FK ไปที่ User) แล้วจึงลบผู้ใช้ทดสอบ
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await disconnectDatabase();
});

describe('GET /api/users/me — ต้องล็อกอิน', () => {
  it('ไม่ส่ง token → 401', async () => {
    const res = await request(app).get('/api/users/me');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, errorCode: 'UNAUTHORIZED' });
  });

  it('token ที่ไม่มีในระบบ → 401', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer not-a-real-session-token');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('session หมดอายุ → 401', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });

  it('บัญชีถูกระงับ แม้ session ยังไม่หมดอายุ → 401', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${suspendedToken}`);

    expect(res.status).toBe(401);
  });

  it('session ที่ใช้ได้ → 200 พร้อมบทบาทและสิทธิ์', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(customerEmail);
    expect(res.body.data.role).toBe('CUSTOMER');
    expect(res.body.data.permissions).toContain('order:read:own');
    // ต้องไม่ส่งข้อมูลภายในออกไป
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.body.data).not.toHaveProperty('deletedAt');
  });

  it('อ่าน session จาก cookie ได้ด้วย (ใช้ตอน dev ที่ frontend/backend อยู่ localhost เดียวกัน)', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Cookie', `authjs.session-token=${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('CUSTOMER');
  });
});

describe('GET /api/admin/overview — RBAC', () => {
  it('ไม่ล็อกอิน → 401', async () => {
    const res = await request(app).get('/api/admin/overview');

    expect(res.status).toBe(401);
  });

  it('CUSTOMER ล็อกอินแล้วแต่ไม่มีสิทธิ์ → 403', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, errorCode: 'FORBIDDEN' });
  });

  it('SUPER_ADMIN → 200 พร้อมตัวเลขจากฐานข้อมูลจริง', async () => {
    const res = await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // seed มี 12 สินค้า 102 variant
    expect(res.body.data.products.total).toBeGreaterThanOrEqual(12);
    expect(res.body.data.products.variants).toBeGreaterThanOrEqual(102);
    // โครงข้อมูลถูกขยายใน STEP 13 — สต็อกต่ำย้ายไปอยู่ใต้ inventory
    expect(typeof res.body.data.inventory.lowStock).toBe('number');
    expect(typeof res.body.data.revenue.total).toBe('number');
  });
});
