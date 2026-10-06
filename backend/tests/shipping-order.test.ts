import { createHmac, randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { getStorePolicyContent } from '../src/services/ai-cs.service.ts';

/**
 * Integration test ของการจัดส่ง (STEP 44) — ยิงผ่าน HTTP กับฐานข้อมูลจริง
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ร้านแก้ค่าส่งแล้ว **ทุกที่** ใช้ตัวเลขใหม่ทันที: หน้า checkout · คำสั่งซื้อ · บทความคลังความรู้ · AI
 *   - ยอดที่ลูกค้าเห็นไม่ตรงกับที่คิดได้ → 409 ไม่สร้างคำสั่งซื้อ ไม่จองของ
 *   - วิธีที่ปิดไว้เลือกไม่ได้ · ปิดวิธีสุดท้ายไม่ได้ · พนักงานแก้อัตราไม่ได้
 *   - พัสดุ: ส่งไม่สำเร็จ → ตีกลับ → ส่งใหม่ / ยกเลิก (รับของเข้าคลัง คืนโควตาคูปอง)
 *     · กด "ส่งถึง" ใบที่พัสดุตีกลับไม่ได้ · ยกเลิกใบที่ของยังอยู่กับขนส่งไม่ได้
 *
 * ⚠️ แก้อัตราค่าส่งของจริงระหว่างเทสต์ — afterAll คืนค่าเดิมทุกช่อง (ไฟล์เทสต์รันทีละไฟล์)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET']!;

interface TestUser {
  id: string;
  token: string;
}

let buyer: TestUser;
let admin: TestUser;
let employee: TestUser;
let variantId: string;

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdCouponIds: string[] = [];
let originalRates: Awaited<ReturnType<typeof readRates>> = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

const ADDRESS = {
  recipientName: 'ผู้รับทดสอบการจัดส่ง',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

const readRates = () =>
  prisma.shippingRate.findMany({
    select: {
      method: true,
      description: true,
      baseFee: true,
      freeOverSubtotal: true,
      etaText: true,
      onlyProvinces: true,
      isActive: true,
    },
  });

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-ship-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token };
}

const patchRate = (user: TestUser, method: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/admin/shipping/rates/${method}`).set(auth(user)).send(body);

async function fillCart(quantity = 1) {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: buyer.id } } });
  const added = await request(app)
    .post('/api/cart/items')
    .set(auth(buyer))
    .send({ variantId, quantity });

  expect(added.status).toBeLessThan(300);
}

const summary = (method = 'STANDARD') =>
  request(app).get(`/api/checkout/summary?shippingMethod=${method}`).set(auth(buyer));

async function placeOrder(body: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/orders')
    .set(auth(buyer))
    .send({
      idempotencyKey: randomUUID(),
      shippingMethod: 'STANDARD',
      newAddress: ADDRESS,
      ...body,
    });

  if (response.status === 201) createdOrderIds.push(response.body.data.id);

  return response;
}

const setOrderStatus = (orderNumber: string, body: Record<string, unknown>, user = admin) =>
  request(app).patch(`/api/admin/orders/${orderNumber}/status`).set(auth(user)).send(body);

const setShipmentStatus = (shipmentId: string, body: Record<string, unknown>, user = admin) =>
  request(app).patch(`/api/admin/shipments/${shipmentId}/status`).set(auth(user)).send(body);

/** สั่ง COD แล้วส่งของออก — คืนเลขคำสั่งซื้อและรหัสพัสดุ */
async function shippedCodOrder(extra: Record<string, unknown> = {}) {
  await fillCart();
  const placed = await placeOrder(extra);
  expect(placed.status).toBe(201);
  const orderNumber: string = placed.body.data.orderNumber;

  const pay = await request(app)
    .post(`/api/orders/${orderNumber}/pay`)
    .set(auth(buyer))
    .send({ provider: 'COD' });
  expect(pay.status).toBe(200);

  expect((await setOrderStatus(orderNumber, { status: 'PACKING' })).status).toBe(200);
  const shipped = await setOrderStatus(orderNumber, {
    status: 'SHIPPING',
    carrier: 'Kerry Express',
    trackingNumber: `SH${suffix}A`,
  });
  expect(shipped.status).toBe(200);

  return {
    orderNumber,
    orderId: placed.body.data.id as string,
    shipmentId: shipped.body.data.shipments[0].id as string,
  };
}

const stockOf = async () =>
  prisma.inventory.findUniqueOrThrow({
    where: { variantId },
    select: { quantity: true, reservedQuantity: true },
  });

function postPaidWebhook(orderId: string) {
  const body = JSON.stringify({
    id: `evt_test_${randomUUID()}`,
    object: 'event',
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${randomUUID().replace(/-/g, '')}`,
        object: 'checkout.session',
        amount_total: 100_00,
        currency: 'thb',
        payment_status: 'paid',
        payment_intent: `pi_test_${randomUUID().replace(/-/g, '')}`,
        status: 'complete',
        metadata: { orderId },
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');

  return request(app)
    .post('/api/payments/webhook/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', `t=${timestamp},v1=${digest}`)
    .send(body);
}

beforeAll(async () => {
  originalRates = await readRates();

  buyer = await createUser('CUSTOMER', 'buyer');
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'staff');

  const variant = await prisma.productVariant.findFirstOrThrow({
    where: {
      isActive: true,
      deletedAt: null,
      product: { status: 'ACTIVE', deletedAt: null },
      inventory: { quantity: { gt: 10 } },
      // ราคาไม่ถึงยอดส่งฟรีเดิม — ค่าส่งจึงมีผลกับยอดจริง
      OR: [{ price: { lt: 900 } }, { price: null, product: { price: { lt: 900 } } }],
    },
    orderBy: { inventory: { quantity: 'desc' } },
    select: { id: true },
  });

  variantId = variant.id;
});

afterAll(async () => {
  // คืนอัตราค่าส่งเดิมทุกช่อง — ไฟล์เทสต์อื่นและหน้าร้านพึ่งค่าเหล่านี้
  for (const rate of originalRates) {
    await prisma.shippingRate.update({
      where: { method: rate.method },
      data: {
        description: rate.description,
        baseFee: rate.baseFee,
        freeOverSubtotal: rate.freeOverSubtotal,
        etaText: rate.etaText,
        onlyProvinces: rate.onlyProvinces,
        isActive: rate.isActive,
      },
    });
  }

  const held = await prisma.orderItem.findMany({
    where: { orderId: { in: createdOrderIds }, order: { status: 'PENDING_PAYMENT' } },
    select: { variantId: true, quantity: true },
  });
  for (const item of held) {
    await prisma.$executeRaw`
      UPDATE "Inventory"
         SET "reservedQuantity" = GREATEST("reservedQuantity" - ${item.quantity}, 0),
             "updatedAt" = now()
       WHERE "variantId" = ${item.variantId}::uuid`;
  }

  // คืนยอดคลังตาม movement ที่เทสต์นี้สร้าง (ตัดออก − รับคืนจากการยกเลิก)
  const movements = await prisma.inventoryMovement.findMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
    select: { variantId: true, type: true, quantity: true },
  });
  const delta = new Map<string, number>();
  for (const movement of movements) {
    const sign = movement.type === 'STOCK_OUT' ? 1 : -1;
    delta.set(movement.variantId, (delta.get(movement.variantId) ?? 0) + sign * movement.quantity);
  }
  for (const [id, amount] of delta) {
    if (amount === 0) continue;
    await prisma.inventory.update({
      where: { variantId: id },
      data: { quantity: { increment: amount } },
    });
    const owner = await prisma.productVariant.findUniqueOrThrow({
      where: { id },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: owner.productId },
      data: { totalStock: { increment: amount } },
    });
  }

  await prisma.inventoryMovement.deleteMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
  });
  await prisma.adminLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await disconnectDatabase();
});

/* ═══════════════════════════ อัตราค่าส่ง ═══════════════════════════ */

describe('ร้านแก้อัตราค่าส่งได้ และทุกที่ใช้ตัวเลขชุดเดียวกัน', () => {
  it('แก้ค่าส่ง → หน้า checkout · คำสั่งซื้อ · บทความ · AI ใช้ตัวเลขใหม่ทันที · ประวัติเก็บระยะเวลาเดิม', async () => {
    const updated = await patchRate(admin, 'STANDARD', {
      baseFee: 65,
      freeOverSubtotal: 5000,
      etaText: '3–5 วันทำการ',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ baseFee: 65, freeOverSubtotal: 5000 });

    // AdminLog: before/after มีคีย์ชุดเดียวกัน (กฎ STEP 27)
    const log = await prisma.adminLog.findFirstOrThrow({
      where: { userId: admin.id, action: 'shipping.rate.update' },
      orderBy: { createdAt: 'desc' },
      select: { before: true, after: true, targetId: true },
    });
    expect(log.targetId).toBe('STANDARD');
    expect(Object.keys(log.before as object).sort()).toEqual(
      Object.keys(log.after as object).sort(),
    );
    expect(log.after).toMatchObject({ baseFee: 65, freeOverSubtotal: 5000 });

    await fillCart();
    const before = await summary();
    expect(before.status).toBe(200);
    expect(before.body.data.shippingFee).toBe(65);

    const article = await request(app).get('/api/ai/knowledge/articles?limit=50');
    const shipping = article.body.data.items.find(
      (item: { slug: string }) => item.slug === 'shipping-rates-and-delivery-time',
    );
    const text = `${shipping.summary}\n${shipping.content}\n${shipping.faqPairs
      .map((faq: { answer: string }) => faq.answer)
      .join('\n')}`;
    expect(text).toContain('65 บาท');
    expect(text).toContain('5,000');
    expect(text).toContain('3–5 วันทำการ');
    expect(text).not.toContain('{{');

    expect(await getStorePolicyContent('shipping')).toContain('65 บาท');

    const placed = await placeOrder({ expectedTotal: before.body.data.total });
    expect(placed.status).toBe(201);
    expect(placed.body.data.shippingFee).toBe(65);
    expect(placed.body.data.shippingEtaText).toBe('3–5 วันทำการ');

    // ร้านแก้ข้อความระยะเวลาภายหลัง — คำสั่งซื้อที่สั่งไปแล้วยังบอกสิ่งที่ลูกค้าเห็นตอนสั่ง
    expect((await patchRate(admin, 'STANDARD', { etaText: '1–2 วันทำการ' })).status).toBe(200);
    const history = await request(app)
      .get(`/api/orders/${placed.body.data.orderNumber}`)
      .set(auth(buyer));
    expect(history.body.data.shippingEtaText).toBe('3–5 วันทำการ');
  });

  it('ยอดที่หน้าเว็บแสดงไม่ตรงกับที่คิดได้ → 409 · ไม่สร้างคำสั่งซื้อ · ไม่จองของ', async () => {
    await fillCart();
    const shown = await summary();
    const stockBefore = await stockOf();

    // ร้านขึ้นค่าส่งระหว่างที่ลูกค้าเปิดหน้า checkout ค้างไว้
    expect((await patchRate(admin, 'STANDARD', { baseFee: 80 })).status).toBe(200);

    const idempotencyKey = randomUUID();
    const rejected = await placeOrder({ idempotencyKey, expectedTotal: shown.body.data.total });

    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toContain('ยอดรวมเปลี่ยน');
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(0);
    expect(await stockOf()).toEqual(stockBefore);

    // ลูกค้าเห็นยอดใหม่แล้วกดยืนยันอีกครั้ง → ผ่าน และเก็บตามยอดที่เห็น
    const fresh = await summary();
    const accepted = await placeOrder({ expectedTotal: fresh.body.data.total });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.total).toBe(fresh.body.data.total);
    expect(accepted.body.data.shippingFee).toBe(80);
  });

  it('ปิดวิธีจัดส่ง → ไม่โผล่ในหน้า checkout หรือ API สาธารณะ · สั่งด้วยวิธีนั้นได้ 409 · ปิดวิธีสุดท้ายไม่ได้', async () => {
    expect((await patchRate(admin, 'EXPRESS', { isActive: false })).status).toBe(200);

    await fillCart();
    const options = (await summary()).body.data.shippingOptions.map(
      (o: { code: string }) => o.code,
    );
    expect(options).not.toContain('EXPRESS');

    const publicOptions = await request(app).get('/api/shipping/options');
    expect(publicOptions.status).toBe(200);
    expect(publicOptions.body.data.options.map((o: { code: string }) => o.code)).not.toContain(
      'EXPRESS',
    );
    expect(publicOptions.body.data.freeShippingFrom).toBe(5000);

    const viaDisabled = await placeOrder({ shippingMethod: 'EXPRESS' });
    expect(viaDisabled.status).toBe(409);

    for (const method of ['SAME_DAY', 'PICKUP']) {
      expect((await patchRate(admin, method, { isActive: false })).status).toBe(200);
    }
    const last = await patchRate(admin, 'STANDARD', { isActive: false });
    expect(last.status).toBe(409);
    expect(
      (await prisma.shippingRate.findUniqueOrThrow({ where: { method: 'STANDARD' } })).isActive,
    ).toBe(true);

    for (const method of ['EXPRESS', 'SAME_DAY', 'PICKUP']) {
      expect((await patchRate(admin, method, { isActive: true })).status).toBe(200);
    }
  });

  it('พนักงานดูอัตราได้แต่แก้ไม่ได้ · ข้อมูลผิดรูปได้ 422 ไม่บันทึก', async () => {
    expect((await request(app).get('/api/admin/shipping/rates').set(auth(employee))).status).toBe(
      200,
    );
    expect((await patchRate(employee, 'STANDARD', { baseFee: 1 })).status).toBe(403);
    expect(
      (await patchRate(admin, 'STANDARD', { description: 'ส่งฟรีเมื่อครบ 999 บาท' })).status,
    ).toBe(422);
    expect((await patchRate(admin, 'SAME_DAY', { onlyProvinces: ['กทม'] })).status).toBe(422);
    expect((await patchRate(admin, 'NOPE', { baseFee: 1 })).status).toBe(422);

    const rate = await prisma.shippingRate.findUniqueOrThrow({ where: { method: 'STANDARD' } });
    expect(Number(rate.baseFee)).toBe(80);
  });
});

/* ═══════════════════════════ พัสดุ ═══════════════════════════ */

describe('พัสดุ: ส่งไม่สำเร็จ → ตีกลับ → ส่งใหม่ → ส่งถึง', () => {
  let orderNumber: string;
  let orderId: string;
  let firstShipmentId: string;
  let secondShipmentId: string;

  it('ส่งของออก → มีประวัติ "ส่งมอบให้ขนส่งแล้ว" · ค้นจากเลขคำสั่งซื้อเจอ', async () => {
    ({ orderNumber, orderId, shipmentId: firstShipmentId } = await shippedCodOrder());

    const list = await request(app)
      .get(`/api/admin/shipments?q=${orderNumber}`)
      .set(auth(employee));
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toEqual([firstShipmentId]);

    const detail = await request(app)
      .get(`/api/admin/shipments/${firstShipmentId}`)
      .set(auth(employee));
    expect(detail.body.data.events.map((event: { status: string }) => event.status)).toEqual([
      'SHIPPED',
    ]);
    expect(
      detail.body.data.allowedNextStatuses.map((next: { status: string }) => next.status),
    ).toEqual(['IN_TRANSIT', 'FAILED', 'RETURNED']);
  });

  it('ส่งไม่สำเร็จต้องมีเหตุผล · ลูกค้าเห็นเหตุผลในหน้าคำสั่งซื้อและในการแจ้งเตือน', async () => {
    expect(
      (await setShipmentStatus(firstShipmentId, { status: 'IN_TRANSIT' }, employee)).status,
    ).toBe(200);
    expect((await setShipmentStatus(firstShipmentId, { status: 'FAILED' })).status).toBe(422);

    const note = `ไม่มีผู้รับที่บ้าน ${suffix}`;
    const failed = await setShipmentStatus(firstShipmentId, { status: 'FAILED', note });
    expect(failed.status).toBe(200);

    const order = await request(app).get(`/api/orders/${orderNumber}`).set(auth(buyer));
    const events = order.body.data.shipments[0].events;
    expect(events.map((event: { status: string }) => event.status)).toEqual([
      'SHIPPED',
      'IN_TRANSIT',
      'FAILED',
    ]);
    expect(events[2].note).toBe(note);

    const notice = await prisma.notification.findFirst({
      where: { userId: buyer.id, type: 'SHIPPING', body: { contains: note } },
    });
    expect(notice).not.toBeNull();
  });

  it('ของยังอยู่กับขนส่ง → ยกเลิกคำสั่งซื้อไม่ได้ · ตีกลับแล้ว → กดส่งถึงไม่ได้', async () => {
    const cancel = await setOrderStatus(orderNumber, { status: 'CANCELLED' });
    expect(cancel.status).toBe(409);

    const returned = await setShipmentStatus(firstShipmentId, {
      status: 'RETURNED',
      note: 'ติดต่อผู้รับไม่ได้ครบ 3 ครั้ง ขนส่งตีกลับ',
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data.orderActions).toEqual({
      canDeliver: false,
      canCancel: true,
      canReship: true,
    });

    expect((await setOrderStatus(orderNumber, { status: 'DELIVERED' })).status).toBe(409);
    // ตีกลับแล้วจบ — ย้อนสถานะไม่ได้
    expect((await setShipmentStatus(firstShipmentId, { status: 'IN_TRANSIT' })).status).toBe(409);

    const adminOrder = await request(app).get(`/api/admin/orders/${orderNumber}`).set(auth(admin));
    expect(adminOrder.body.data.allowedNextStatuses).toEqual(['CANCELLED']);
    expect(adminOrder.body.data.canReship).toBe(true);
  });

  it('ส่งใหม่ → พัสดุชิ้นใหม่ เลขพัสดุใหม่ แจ้งลูกค้า · ชิ้นเก่าคงสถานะตีกลับและแก้ไม่ได้', async () => {
    const resend = await request(app)
      .post(`/api/admin/orders/${orderNumber}/shipments`)
      .set(auth(employee))
      .send({ carrier: 'Flash Express', trackingNumber: `SH${suffix}B` });

    expect(resend.status).toBe(201);
    secondShipmentId = resend.body.data.id;
    expect(secondShipmentId).not.toBe(firstShipmentId);

    // ส่งใหม่ซ้ำไม่ได้ — ชิ้นล่าสุดยังไม่ได้ตีกลับ
    const again = await request(app)
      .post(`/api/admin/orders/${orderNumber}/shipments`)
      .set(auth(employee))
      .send({ carrier: 'Flash Express', trackingNumber: `SH${suffix}C` });
    expect(again.status).toBe(409);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { trackingNumber: true },
    });
    expect(order.trackingNumber).toBe(`SH${suffix}B`);
    expect(
      await prisma.notification.count({
        where: { userId: buyer.id, type: 'SHIPPING', body: { contains: `SH${suffix}B` } },
      }),
    ).toBe(1);

    expect((await setShipmentStatus(firstShipmentId, { status: 'IN_TRANSIT' })).status).toBe(409);
  });

  it('แก้เลขพัสดุที่กรอกผิด → ต้องมีเหตุผล · cache ที่คำสั่งซื้อเปลี่ยนตาม · แจ้งลูกค้า · log มีแค่ช่องที่เปลี่ยน', async () => {
    const missingReason = await request(app)
      .patch(`/api/admin/shipments/${secondShipmentId}`)
      .set(auth(employee))
      .send({ trackingNumber: `SH${suffix}D` });
    expect(missingReason.status).toBe(422);

    const fixed = await request(app)
      .patch(`/api/admin/shipments/${secondShipmentId}`)
      .set(auth(employee))
      .send({
        trackingNumber: `SH${suffix}D`,
        carrier: 'Flash Express',
        reason: 'พิมพ์เลขพัสดุผิดหนึ่งหลัก',
      });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.trackingNumber).toBe(`SH${suffix}D`);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { trackingNumber: true },
    });
    expect(order.trackingNumber).toBe(`SH${suffix}D`);

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'shipping.shipment.update', targetId: secondShipmentId },
      select: { before: true, after: true },
    });
    // ขนส่งไม่ได้เปลี่ยน (ส่งค่าเดิมมา) จึงไม่อยู่ในประวัติ
    expect(log.before).toEqual({ trackingNumber: `SH${suffix}B` });
    expect(log.after).toEqual({
      trackingNumber: `SH${suffix}D`,
      reason: 'พิมพ์เลขพัสดุผิดหนึ่งหลัก',
    });

    expect(
      await prisma.notification.count({
        where: { userId: buyer.id, type: 'SHIPPING', body: { contains: `SH${suffix}D` } },
      }),
    ).toBe(1);
  });

  it('ส่งถึง → เฉพาะชิ้นที่ยังอยู่กับขนส่งเป็น "ส่งถึงแล้ว" · ชิ้นที่ตีกลับคงเดิม · COD ได้เงิน', async () => {
    const delivered = await setOrderStatus(orderNumber, { status: 'DELIVERED' });
    expect(delivered.status).toBe(200);

    const shipments = await prisma.shipment.findMany({
      where: { orderId },
      select: { id: true, status: true },
    });
    const statusOf = new Map(shipments.map((shipment) => [shipment.id, shipment.status]));
    expect(statusOf.get(firstShipmentId)).toBe('RETURNED');
    expect(statusOf.get(secondShipmentId)).toBe('DELIVERED');

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { paymentStatus: true },
    });
    expect(order.paymentStatus).toBe('PAID');

    // ใบที่จบแล้ว — แก้พัสดุไม่ได้อีก
    expect(
      (await setShipmentStatus(secondShipmentId, { status: 'FAILED', note: 'ทดสอบหลังจบ' })).status,
    ).toBe(409);
  });
});

describe('พัสดุตีกลับแล้วยกเลิกคำสั่งซื้อ', () => {
  it('ของกลับเข้าคลัง · โควตาคูปองคืน · COD ไม่ถูกนับว่าได้เงิน', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: `SHIP${suffix.toUpperCase()}`,
        name: 'คูปองทดสอบการจัดส่ง',
        type: 'FIXED_AMOUNT',
        value: 10,
        usageLimit: 5,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true, code: true },
    });
    createdCouponIds.push(coupon.id);

    const stockBefore = await stockOf();
    const { orderNumber, orderId, shipmentId } = await shippedCodOrder({ couponCode: coupon.code });

    expect((await stockOf()).quantity).toBe(stockBefore.quantity - 1);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);

    expect(
      (await setShipmentStatus(shipmentId, { status: 'RETURNED', note: 'ลูกค้าปฏิเสธการรับพัสดุ' }))
        .status,
    ).toBe(200);
    expect((await setOrderStatus(orderNumber, { status: 'CANCELLED' })).status).toBe(200);

    expect(await stockOf()).toEqual(stockBefore);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, paymentStatus: true },
    });
    expect(order).toEqual({ status: 'CANCELLED', paymentStatus: 'CANCELLED' });
  });

  /**
   * บั๊กที่เจอระหว่าง STEP 44 — ร้านยกเลิกใบที่ **จ่ายแล้ว** ไม่เคยคืนโควตาคูปอง
   * (เดิมคืนเฉพาะใบที่ยังรอชำระ) ขัดกับกฎ STEP 41 ข้อ 5 ที่ว่า "ทุกที่"
   */
  it('ร้านยกเลิกใบที่ลูกค้าจ่ายผ่าน Stripe แล้ว → โควตาคูปองคืนด้วย', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: `PAID${suffix.toUpperCase()}`,
        name: 'คูปองทดสอบยกเลิกหลังจ่าย',
        type: 'FIXED_AMOUNT',
        value: 10,
        usageLimit: 5,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true, code: true },
    });
    createdCouponIds.push(coupon.id);

    await fillCart();
    const placed = await placeOrder({ couponCode: coupon.code });
    expect(placed.status).toBe(201);
    expect((await postPaidWebhook(placed.body.data.id)).status).toBe(200);

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: placed.body.data.id },
      select: { status: true, paymentStatus: true },
    });
    expect(paid.paymentStatus).toBe('PAID');
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);

    expect(
      (await setOrderStatus(placed.body.data.orderNumber, { status: 'CANCELLED' })).status,
    ).toBe(200);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
  });
});

describe('คูปองกับทุกวิธีจัดส่ง', () => {
  /**
   * บั๊กที่เจอระหว่าง STEP 44 — validator ของ /api/coupons/apply พิมพ์รายการวิธีจัดส่งเองแค่ 3 วิธี
   * ลูกค้าที่เลือก "รับที่ร้าน" แล้วกดใช้คูปองได้ 422 ทุกครั้ง
   */
  it('ใช้คูปองตอนเลือก "รับที่ร้าน" ได้', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        code: `PICK${suffix.toUpperCase()}`,
        name: 'คูปองทดสอบรับที่ร้าน',
        type: 'FIXED_AMOUNT',
        value: 10,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true, code: true },
    });
    createdCouponIds.push(coupon.id);

    await fillCart();
    const applied = await request(app)
      .post('/api/coupons/apply')
      .set(auth(buyer))
      .send({ code: coupon.code, shippingMethod: 'PICKUP' });

    expect(applied.status).toBe(200);
    expect(applied.body.data.usable).toBe(true);
  });
});

describe('ด่านของหน้าพัสดุ', () => {
  it('ลูกค้าเข้าหน้าพัสดุของร้านไม่ได้ · ลิงก์ติดตามที่ไม่ใช่ https ถูกปฏิเสธตอนส่งของ', async () => {
    expect((await request(app).get('/api/admin/shipments').set(auth(buyer))).status).toBe(403);

    await fillCart();
    const placed = await placeOrder();
    const orderNumber = placed.body.data.orderNumber;
    await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth(buyer))
      .send({ provider: 'COD' });
    await setOrderStatus(orderNumber, { status: 'PACKING' });

    const unsafe = await setOrderStatus(orderNumber, {
      status: 'SHIPPING',
      carrier: 'Kerry Express',
      trackingNumber: `SH${suffix}X`,
      trackingUrl: 'javascript:alert(1)',
    });
    expect(unsafe.status).toBe(422);
  });
});
