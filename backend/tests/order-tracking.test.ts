import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของประวัติ/ติดตามคำสั่งซื้อ (STEP 12)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - เห็นเฉพาะคำสั่งซื้อของตัวเอง (กรอง userId ทุก query)
 *   - ตัวเลขข้างแท็บสถานะตรงกับผลกรองจริง
 *   - ไทม์ไลน์ใช้ timestamp จริงจากฐานข้อมูล · ขั้นที่ยังไม่เกิด `at = null` (ไม่เดาเวลา)
 *   - ออเดอร์ที่ยกเลิกแสดงเส้นทางที่เกิดขึ้นจริง ไม่โชว์ขั้นที่ไม่มีทางเกิด
 *   - เลขพัสดุ/ใบจัดส่งแสดงตามที่มีจริง (ว่างได้ ไม่สร้างข้อมูลปลอม)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

interface TestUser {
  id: string;
  token: string;
}

let owner: TestUser = { id: '', token: '' };
let stranger: TestUser = { id: '', token: '' };
let variant = { id: '', available: 0, finalPrice: 0 };
const touchedVariantIds = new Set<string>();

const ADDRESS = {
  recipientName: 'ผู้รับทดสอบ',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

async function createUser(label: string): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email: `test-track-${label}-${suffix}@teenstyle.test`, roleId: role.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

async function placeOrder(user: TestUser): Promise<string> {
  touchedVariantIds.add(variant.id);
  await request(app)
    .post('/api/cart/items')
    .set(auth(user))
    .send({ variantId: variant.id, quantity: 1 });

  const res = await request(app)
    .post('/api/orders')
    .set(auth(user))
    .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', newAddress: ADDRESS });

  expect(res.status).toBe(201);

  return res.body.data.orderNumber as string;
}

beforeAll(async () => {
  owner = await createUser('owner');
  stranger = await createUser('stranger');

  const res = await request(app).get('/api/products/oversize-cotton-tee');
  variant = (res.body.data.variants as (typeof variant)[]).find((item) => item.available > 0)!;
});

afterAll(async () => {
  const userIds = [owner.id, stranger.id];

  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);

  /**
   * InventoryMovement ไม่มี FK ไปที่ Order (referenceId เป็นแค่ UUID)
   * ถ้าไม่ลบเองจะเหลือเป็น orphan และทำให้เทสต์ไฟล์อื่นที่นับ movement เพี้ยน
   * — พร้อมกันนั้นต้องคืนสต็อกที่ถูกตัดไปตอนยืนยัน COD ด้วย
   */
  const deducted = await prisma.inventoryMovement.groupBy({
    by: ['variantId'],
    where: { referenceType: 'ORDER', referenceId: { in: orderIds }, type: 'STOCK_OUT' },
    _sum: { quantity: true },
  });

  for (const row of deducted) {
    const amount = row._sum.quantity ?? 0;
    if (amount === 0) continue;

    await prisma.inventory.update({
      where: { variantId: row.variantId },
      data: { quantity: { increment: amount } },
    });

    const variantRow = await prisma.productVariant.findUniqueOrThrow({
      where: { id: row.variantId },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: variantRow.productId },
      data: { totalStock: { increment: amount } },
    });
  }

  await prisma.inventoryMovement.deleteMany({
    where: { referenceType: 'ORDER', referenceId: { in: orderIds } },
  });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.inventory.updateMany({
    where: { variantId: { in: [...touchedVariantIds] } },
    data: { reservedQuantity: 0 },
  });

  await disconnectDatabase();
});

describe('GET /api/orders — ประวัติคำสั่งซื้อ', () => {
  it('ไม่ล็อกอิน → 401', async () => {
    const res = await request(app).get('/api/orders');

    expect(res.status).toBe(401);
  });

  it('คืนเฉพาะคำสั่งซื้อของตัวเอง', async () => {
    const mine = await placeOrder(owner);
    const theirs = await placeOrder(stranger);

    const res = await request(app).get('/api/orders').set(auth(owner));

    expect(res.status).toBe(200);
    const numbers = (res.body.data.items as { orderNumber: string }[]).map(
      (order) => order.orderNumber,
    );

    expect(numbers).toContain(mine);
    expect(numbers).not.toContain(theirs);
  });

  it('เรียงจากใหม่ไปเก่า และแบ่งหน้าได้', async () => {
    await placeOrder(owner);
    await placeOrder(owner);

    const page1 = await request(app).get('/api/orders?limit=1&page=1').set(auth(owner));
    const page2 = await request(app).get('/api/orders?limit=1&page=2').set(auth(owner));

    expect(page1.body.data.items.length).toBe(1);
    expect(page1.body.data.total).toBeGreaterThanOrEqual(2);
    expect(page1.body.data.items[0].orderNumber).not.toBe(page2.body.data.items[0].orderNumber);
    expect(new Date(page1.body.data.items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(page2.body.data.items[0].createdAt).getTime(),
    );
  });

  it('ตัวเลขข้างสถานะตรงกับผลกรองจริง', async () => {
    await placeOrder(owner);

    const all = await request(app).get('/api/orders?limit=50').set(auth(owner));
    const counts = all.body.data.counts as { status: string; count: number }[];

    for (const entry of counts) {
      const filtered = await request(app)
        .get(`/api/orders?status=${entry.status}&limit=50`)
        .set(auth(owner));

      expect(filtered.body.data.total).toBe(entry.count);
      for (const order of filtered.body.data.items as { status: string }[]) {
        expect(order.status).toBe(entry.status);
      }
    }
  });

  it('สถานะที่ไม่มีใน enum → 422 · limit เกินเพดาน → 422', async () => {
    const badStatus = await request(app).get('/api/orders?status=SHIPPED_MAYBE').set(auth(owner));
    const badLimit = await request(app).get('/api/orders?limit=999').set(auth(owner));

    expect(badStatus.status).toBe(422);
    expect(badLimit.status).toBe(422);
  });
});

describe('ไทม์ไลน์คำสั่งซื้อ', () => {
  it('ออเดอร์ใหม่: ขั้นแรกเกิดแล้ว ขั้นที่เหลือยังไม่มีเวลา', async () => {
    const orderNumber = await placeOrder(owner);

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(owner));
    const timeline = res.body.data.timeline as {
      status: string;
      at: string | null;
      done: boolean;
      current: boolean;
    }[];

    expect(timeline.length).toBeGreaterThanOrEqual(6);
    expect(timeline[0]!.status).toBe('PENDING_PAYMENT');
    expect(timeline[0]!.done).toBe(true);
    expect(timeline[0]!.at).not.toBeNull();
    expect(timeline[0]!.current).toBe(true);

    // ขั้นที่ยังไม่เกิดต้องไม่มีเวลา — ห้ามเดา
    for (const step of timeline.slice(1)) {
      expect(step.at).toBeNull();
      expect(step.done).toBe(false);
    }
  });

  it('ยืนยัน COD แล้ว: ขั้น "ร้านรับออเดอร์" มีเวลาจริงและเป็นขั้นปัจจุบัน', async () => {
    const orderNumber = await placeOrder(owner);
    await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth(owner))
      .send({ provider: 'COD' });

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(owner));
    const timeline = res.body.data.timeline as {
      status: string;
      at: string | null;
      current: boolean;
    }[];
    const processing = timeline.find((step) => step.status === 'PROCESSING')!;

    expect(processing.at).not.toBeNull();
    expect(processing.current).toBe(true);
    // COD ยังไม่ได้รับเงิน → ขั้น "ชำระเงินแล้ว" ต้องยังว่าง
    expect(timeline.find((step) => step.status === 'PAID')!.at).toBeNull();
  });

  it('ออเดอร์ที่ยกเลิก: ปิดท้ายด้วยการยกเลิก และไม่โชว์ขั้นที่ไม่มีทางเกิด', async () => {
    const orderNumber = await placeOrder(owner);
    await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth(owner));

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(owner));
    const timeline = res.body.data.timeline as { status: string; at: string | null }[];

    expect(timeline.at(-1)!.status).toBe('CANCELLED');
    expect(timeline.at(-1)!.at).not.toBeNull();
    // ทุกขั้นที่เหลือต้องเป็นขั้นที่เกิดขึ้นจริงเท่านั้น
    for (const step of timeline) {
      expect(step.at).not.toBeNull();
    }
    expect(timeline.some((step) => step.status === 'DELIVERED')).toBe(false);
  });

  it('ยังไม่มีใบจัดส่ง → shipments ว่าง และ trackingNumber เป็น null (ไม่สร้างข้อมูลปลอม)', async () => {
    const orderNumber = await placeOrder(owner);

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(owner));

    expect(res.body.data.shipments).toEqual([]);
    expect(res.body.data.trackingNumber).toBeNull();
  });

  it('แสดงใบจัดส่งจริงเมื่อร้านสร้างไว้', async () => {
    const orderNumber = await placeOrder(owner);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    await prisma.shipment.create({
      data: {
        orderId: order.id,
        carrier: 'Flash Express',
        trackingNumber: 'TH0000TEST01',
        trackingUrl: 'https://example.com/track/TH0000TEST01',
        status: 'IN_TRANSIT',
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { trackingNumber: 'TH0000TEST01', shippedAt: new Date() },
    });

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(owner));

    expect(res.body.data.trackingNumber).toBe('TH0000TEST01');
    expect(res.body.data.shipments.length).toBe(1);
    expect(res.body.data.shipments[0].carrier).toBe('Flash Express');
    expect(res.body.data.shipments[0].status).toBe('IN_TRANSIT');

    const shipped = (res.body.data.timeline as { status: string; at: string | null }[]).find(
      (step) => step.status === 'SHIPPING',
    )!;
    expect(shipped.at).not.toBeNull();
  });

  it('ดูออเดอร์ของคนอื่น → 404', async () => {
    const orderNumber = await placeOrder(owner);

    const res = await request(app).get(`/api/orders/${orderNumber}`).set(auth(stranger));

    expect(res.status).toBe(404);
  });
});
