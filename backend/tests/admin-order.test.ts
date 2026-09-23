import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของหลังบ้าน: Dashboard + จัดการคำสั่งซื้อ (STEP 13)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - RBAC: ลูกค้าเข้าไม่ได้ (403) · พนักงานเข้าได้ตามสิทธิ์
 *   - ตัวเลข dashboard นับจากฐานข้อมูลจริง และ **COD ที่ยังไม่เก็บเงินไม่นับเป็นยอดขาย**
 *   - เปลี่ยนสถานะได้เฉพาะเส้นทางที่อนุญาต (ข้ามขั้นไม่ได้)
 *   - ส่งของต้องมีเลขพัสดุจริง · DELIVERED ของ COD → ถือว่าได้รับเงิน
 *   - ยกเลิกออเดอร์ที่ตัดสต็อกแล้ว → ของกลับเข้าคลัง (RETURN movement) และรับคืนซ้ำไม่ได้
 *   - ทุกการเปลี่ยนสถานะเขียน AdminLog
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let staff = { id: '', token: '' };
let customer = { id: '', token: '' };
let variant = { id: '', available: 0, finalPrice: 0 };
const createdOrderIds: string[] = [];
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

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-admin-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
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

function asCustomer() {
  return { Authorization: `Bearer ${customer.token}` };
}

/** สร้างออเดอร์ของลูกค้า แล้ว (ถ้าขอ) ยืนยัน COD เพื่อให้สต็อกถูกตัดจริง */
async function makeOrder(options: { confirmCod?: boolean } = {}): Promise<string> {
  touchedVariantIds.add(variant.id);

  await request(app)
    .post('/api/cart/items')
    .set(asCustomer())
    .send({ variantId: variant.id, quantity: 1 });

  const created = await request(app)
    .post('/api/orders')
    .set(asCustomer())
    .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', newAddress: ADDRESS });

  expect(created.status).toBe(201);
  const orderNumber = created.body.data.orderNumber as string;

  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber },
    select: { id: true },
  });
  createdOrderIds.push(order.id);

  if (options.confirmCod === true) {
    const paid = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(asCustomer())
      .send({ provider: 'COD' });
    expect(paid.status).toBe(200);
  }

  return orderNumber;
}

function setStatus(orderNumber: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/admin/orders/${orderNumber}/status`).set(asStaff()).send(body);
}

async function inventoryOf(): Promise<{ quantity: number; reservedQuantity: number }> {
  return prisma.inventory.findUniqueOrThrow({
    where: { variantId: variant.id },
    select: { quantity: true, reservedQuantity: true },
  });
}

beforeAll(async () => {
  staff = await createUser('ADMIN', 'staff');
  customer = await createUser('CUSTOMER', 'cust');

  const res = await request(app).get('/api/products/oversize-cotton-tee');
  variant = (res.body.data.variants as (typeof variant)[]).find((item) => item.available > 0)!;
});

afterAll(async () => {
  const userIds = [staff.id, customer.id];

  // คืนสต็อกให้ตรงตาม movement ที่เทสต์นี้สร้าง (ตัดออก − รับคืน)
  const movements = await prisma.inventoryMovement.findMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
    select: { variantId: true, type: true, quantity: true },
  });

  const delta = new Map<string, number>();
  for (const movement of movements) {
    const sign = movement.type === 'STOCK_OUT' ? 1 : -1;
    delta.set(movement.variantId, (delta.get(movement.variantId) ?? 0) + sign * movement.quantity);
  }

  for (const [variantId, amount] of delta) {
    if (amount === 0) continue;

    await prisma.inventory.update({
      where: { variantId },
      data: { quantity: { increment: amount } },
    });
    const row = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: row.productId },
      data: { totalStock: { increment: amount } },
    });
  }

  await prisma.inventoryMovement.deleteMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
  });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
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

describe('RBAC ของหลังบ้าน', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้า → 403', async () => {
    const anonymous = await request(app).get('/api/admin/orders');
    const asShopper = await request(app).get('/api/admin/orders').set(asCustomer());

    expect(anonymous.status).toBe(401);
    expect(asShopper.status).toBe(403);
  });

  it('ลูกค้าเปลี่ยนสถานะออเดอร์ไม่ได้ → 403', async () => {
    const orderNumber = await makeOrder();

    const res = await request(app)
      .patch(`/api/admin/orders/${orderNumber}/status`)
      .set(asCustomer())
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/overview', () => {
  it('ตัวเลขนับจากฐานข้อมูลจริง และ COD ที่ยังไม่เก็บเงินไม่นับเป็นยอดขาย', async () => {
    await makeOrder({ confirmCod: true });

    const res = await request(app).get('/api/admin/overview').set(asStaff());

    expect(res.status).toBe(200);
    const data = res.body.data;

    // ยอดขายนับเฉพาะเงินที่ได้รับจริง — COD ที่ยังไม่ส่งถึงยังไม่ใช่รายได้
    expect(data.revenue.pendingCodAmount).toBeGreaterThan(0);
    expect(data.orders.total).toBeGreaterThan(0);
    expect(data.products.total).toBeGreaterThanOrEqual(12);
    expect(data.inventory.totalUnits).toBeGreaterThan(0);
    expect(Array.isArray(data.orders.byStatus)).toBe(true);
    expect(Array.isArray(data.topProducts)).toBe(true);
  });

  it('สินค้าขายดีนับจากออเดอร์ที่จ่ายเงินแล้วเท่านั้น', async () => {
    const before = await request(app).get('/api/admin/overview').set(asStaff());
    const beforeTop = before.body.data.topProducts.length as number;

    // ออเดอร์ COD ที่ยังไม่ส่งถึง → ยังไม่ควรถูกนับเป็นสินค้าขายดี
    await makeOrder({ confirmCod: true });

    const after = await request(app).get('/api/admin/overview').set(asStaff());
    expect(after.body.data.topProducts.length).toBe(beforeTop);
  });
});

describe('PATCH /api/admin/orders/:orderNumber/status', () => {
  it('ข้ามขั้นไม่ได้: รอชำระเงิน → ส่งถึงแล้ว = 422 (นอกรายการที่จัดการได้) หรือ 409', async () => {
    const orderNumber = await makeOrder();

    const res = await setStatus(orderNumber, { status: 'DELIVERED' });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('PENDING_PAYMENT');
  });

  it('เส้นทางปกติของ COD: PROCESSING → PACKING → SHIPPING → DELIVERED', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });

    const packing = await setStatus(orderNumber, { status: 'PACKING' });
    expect(packing.status).toBe(200);
    expect(packing.body.data.status).toBe('PACKING');

    // ส่งของต้องมีเลขพัสดุจริง
    const withoutTracking = await setStatus(orderNumber, { status: 'SHIPPING' });
    expect(withoutTracking.status).toBe(400);

    const shipping = await setStatus(orderNumber, {
      status: 'SHIPPING',
      carrier: 'Flash Express',
      trackingNumber: 'TH-TEST-0001',
      trackingUrl: 'https://example.com/track/TH-TEST-0001',
    });
    expect(shipping.status).toBe(200);
    expect(shipping.body.data.trackingNumber).toBe('TH-TEST-0001');
    expect(shipping.body.data.shipments[0].carrier).toBe('Flash Express');

    const delivered = await setStatus(orderNumber, { status: 'DELIVERED' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe('DELIVERED');
    // COD: ได้รับเงินตอนส่งถึง
    expect(delivered.body.data.paymentStatus).toBe('PAID');
    expect(delivered.body.data.shipments[0].status).toBe('DELIVERED');

    // ส่งถึงแล้วเปลี่ยนต่อไม่ได้
    const again = await setStatus(orderNumber, { status: 'CANCELLED' });
    expect(again.status).toBe(409);
  });

  it('ยกเลิกออเดอร์ที่รอชำระเงิน → คืนของที่จองไว้ (quantity ไม่เปลี่ยน)', async () => {
    const orderNumber = await makeOrder();
    const before = await inventoryOf();

    const res = await setStatus(orderNumber, {
      status: 'CANCELLED',
      adminNote: 'ลูกค้าแจ้งยกเลิก',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.adminNote).toBe('ลูกค้าแจ้งยกเลิก');

    const after = await inventoryOf();
    expect(after.quantity).toBe(before.quantity);
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 1);
  });

  it('ยกเลิกออเดอร์ที่ตัดสต็อกแล้ว → ของกลับเข้าคลังพร้อม movement RETURN', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });
    const before = await inventoryOf();

    const res = await setStatus(orderNumber, { status: 'CANCELLED' });

    expect(res.status).toBe(200);

    const after = await inventoryOf();
    expect(after.quantity).toBe(before.quantity + 1);

    const movements = await prisma.inventoryMovement.findMany({
      where: { referenceType: 'ORDER', referenceId: order.id },
      select: { type: true, quantity: true },
    });
    expect(movements.some((movement) => movement.type === 'STOCK_OUT')).toBe(true);
    expect(movements.some((movement) => movement.type === 'RETURN')).toBe(true);
  });

  it('ทุกการเปลี่ยนสถานะเขียน AdminLog พร้อมค่าก่อน/หลัง', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    await setStatus(orderNumber, { status: 'PACKING' });

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'order.status.update', targetId: order.id },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, before: true, after: true, targetType: true },
    });

    expect(log.userId).toBe(staff.id);
    // STEP 27: targetType เป็นค่ามาตรฐานจาก writeAdminLog แล้ว (เดิมเขียน 'ORDER')
    expect(log.targetType).toBe('Order');
    expect(JSON.stringify(log.before)).toContain('PROCESSING');
    expect(JSON.stringify(log.after)).toContain('PACKING');
  });

  it('สถานะที่ร้านเปลี่ยนเองไม่ได้ (REFUNDED) → 422', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });

    const res = await setStatus(orderNumber, { status: 'REFUNDED' });

    expect(res.status).toBe(422);
  });

  it('เลขพัสดุผิดรูปแบบ → 422', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });
    await setStatus(orderNumber, { status: 'PACKING' });

    const res = await setStatus(orderNumber, {
      status: 'SHIPPING',
      carrier: 'Flash',
      trackingNumber: 'เลขพัสดุไทย!!',
    });

    expect(res.status).toBe(422);
  });

  it('ออเดอร์ที่ไม่มีจริง → 404 · เลขผิดรูปแบบ → 422', async () => {
    const missing = await setStatus('TS-19990101-0001', { status: 'PACKING' });
    const malformed = await setStatus('not-an-order', { status: 'PACKING' });

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(422);
  });

  it('origin อื่น → 403 (CSRF)', async () => {
    const orderNumber = await makeOrder({ confirmCod: true });

    const res = await request(app)
      .patch(`/api/admin/orders/${orderNumber}/status`)
      .set(asStaff())
      .set('Origin', 'http://evil.example.com')
      .send({ status: 'PACKING' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/orders', () => {
  it('เห็นออเดอร์ของลูกค้าทุกคน พร้อมข้อมูลลูกค้าและสถานะที่เปลี่ยนต่อได้', async () => {
    const orderNumber = await makeOrder();

    const res = await request(app).get('/api/admin/orders?limit=50').set(asStaff());

    expect(res.status).toBe(200);
    const found = (
      res.body.data.items as { orderNumber: string; customer: { email: string } }[]
    ).find((order) => order.orderNumber === orderNumber);

    expect(found).toBeDefined();
    expect(found?.customer.email).toContain('test-admin-cust');

    const detail = await request(app).get(`/api/admin/orders/${orderNumber}`).set(asStaff());
    expect(detail.body.data.allowedNextStatuses).toEqual(['CANCELLED']);
  });

  it('ค้นหาด้วยเลขคำสั่งซื้อและกรองตามสถานะได้', async () => {
    const orderNumber = await makeOrder();

    const search = await request(app).get(`/api/admin/orders?q=${orderNumber}`).set(asStaff());
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.items[0].orderNumber).toBe(orderNumber);

    const filtered = await request(app)
      .get('/api/admin/orders?status=PENDING_PAYMENT&limit=50')
      .set(asStaff());
    for (const order of filtered.body.data.items as { status: string }[]) {
      expect(order.status).toBe('PENDING_PAYMENT');
    }
  });

  it('สถานะที่ไม่มีใน enum → 422', async () => {
    const res = await request(app).get('/api/admin/orders?status=NOPE').set(asStaff());

    expect(res.status).toBe(422);
  });
});
