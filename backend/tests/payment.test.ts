import { createHmac, randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของการชำระเงิน (STEP 11)
 *
 * ครอบเส้นทางเงินที่สำคัญที่สุด:
 *   - COD: ยืนยันออเดอร์ → **ตัดสต็อกจริงครั้งเดียว** + เขียน InventoryMovement
 *   - Stripe webhook: ลายเซ็นถูก → จ่ายแล้ว + ตัดสต็อก · ลายเซ็นผิด → 400
 *     · event เดิมยิงซ้ำ → ไม่ตัดสต็อกซ้ำ · session หมดอายุ → คืนของเข้าคลัง
 *   - ยกเลิกออเดอร์ที่ยังไม่จ่าย → คืนของ · ยกเลิกออเดอร์ที่จ่ายแล้ว → 409
 *   - Stripe ที่ยังไม่ได้ตั้ง key ต้อง **ปิดช่องทาง** ไม่ใช่แกล้งทำว่าจ่ายได้
 *
 * ลายเซ็น webhook เซ็นเองด้วย secret ทดสอบใน tests/setup.ts (ไม่ต้องมีบัญชี Stripe)
 */
const app = createApp();
const prisma = getPrisma();

const WEBHOOK_SECRET = 'whsec_test_local_only_not_a_real_secret';
const suffix = randomUUID().slice(0, 8);

let userId = '';
let userToken = '';
let variant = { id: '', available: 0, finalPrice: 0, sku: '' };
const createdOrderIds: string[] = [];

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

function auth() {
  return { Authorization: `Bearer ${userToken}` };
}

/** สร้างออเดอร์ใหม่ (รอชำระเงิน) แล้วคืนเลขออเดอร์ */
async function createOrder(quantity = 1): Promise<string> {
  await request(app).post('/api/cart/items').set(auth()).send({ variantId: variant.id, quantity });

  const res = await request(app)
    .post('/api/orders')
    .set(auth())
    .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', newAddress: ADDRESS });

  expect(res.status).toBe(201);
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: res.body.data.orderNumber },
    select: { id: true },
  });
  createdOrderIds.push(order.id);

  return res.body.data.orderNumber as string;
}

async function inventoryOf(): Promise<{ quantity: number; reservedQuantity: number }> {
  return prisma.inventory.findUniqueOrThrow({
    where: { variantId: variant.id },
    select: { quantity: true, reservedQuantity: true },
  });
}

/** payload + ลายเซ็นแบบเดียวกับที่ Stripe ส่งมา */
function signedEvent(event: Record<string, unknown>): { body: string; signature: string } {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');

  return { body, signature: `t=${timestamp},v1=${digest}` };
}

function sessionEvent(
  type: string,
  orderId: string,
  options: { eventId?: string; sessionId?: string } = {},
): Record<string, unknown> {
  return {
    id: options.eventId ?? `evt_test_${randomUUID()}`,
    object: 'event',
    api_version: '2025-01-01',
    created: Math.floor(Date.now() / 1000),
    type,
    data: {
      object: {
        id: options.sessionId ?? `cs_test_${randomUUID().replace(/-/g, '')}`,
        object: 'checkout.session',
        amount_total: 100_00,
        currency: 'thb',
        payment_status:
          type.includes('succeeded') || type.endsWith('completed') ? 'paid' : 'unpaid',
        payment_intent: `pi_test_${randomUUID().replace(/-/g, '')}`,
        status: type === 'checkout.session.expired' ? 'expired' : 'complete',
        metadata: { orderId },
      },
    },
  };
}

function postWebhook(event: Record<string, unknown>, badSignature = false) {
  const { body, signature } = signedEvent(event);

  return request(app)
    .post('/api/payments/webhook/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', badSignature ? 't=1,v1=deadbeef' : signature)
    .send(body);
}

beforeAll(async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email: `test-pay-${suffix}@teenstyle.test`, roleId: role.id },
  });
  userId = user.id;

  userToken = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: userToken, userId, expires: new Date(Date.now() + 3_600_000) },
  });

  const res = await request(app).get('/api/products/oversize-cotton-tee');
  variant = (res.body.data.variants as (typeof variant)[]).find((item) => item.available > 0)!;
});

afterAll(async () => {
  const before = await prisma.inventory.findUniqueOrThrow({
    where: { variantId: variant.id },
    select: { quantity: true },
  });

  // ลบร่องรอยของเทสต์ แล้วคืนสต็อกให้เท่าเดิม (เทสต์นี้ตัดสต็อกจริง)
  const deducted = await prisma.inventoryMovement.aggregate({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
    _sum: { quantity: true },
  });

  await prisma.inventoryMovement.deleteMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
  });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.address.deleteMany({ where: { userId } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });

  const restore = deducted._sum.quantity ?? 0;
  await prisma.inventory.update({
    where: { variantId: variant.id },
    data: { quantity: before.quantity + restore, reservedQuantity: 0 },
  });
  await prisma.productVariant
    .findUniqueOrThrow({ where: { id: variant.id }, select: { productId: true } })
    .then(({ productId }) =>
      prisma.product.update({
        where: { id: productId },
        data: { totalStock: { increment: restore } },
      }),
    );

  await disconnectDatabase();
});

describe('GET /api/payments/methods', () => {
  it('บอกตรง ๆ ว่าช่องทางไหนใช้ได้ และช่องทางที่ตั้งค่าไม่ครบถูกปิด', async () => {
    const res = await request(app).get('/api/payments/methods');

    expect(res.status).toBe(200);

    const stripe = res.body.data.methods.find((m: { code: string }) => m.code === 'STRIPE');
    const cod = res.body.data.methods.find((m: { code: string }) => m.code === 'COD');

    // ยังไม่ได้ตั้ง STRIPE_SECRET_KEY → ต้องปิด และมีเหตุผลที่อ่านรู้เรื่อง
    expect(stripe.available).toBe(false);
    expect(stripe.unavailableReason).toContain('STRIPE_SECRET_KEY');
    expect(cod.available).toBe(true);
  });
});

describe('COD — เก็บเงินปลายทาง', () => {
  it('ยืนยันแล้วตัดสต็อกจริงครั้งเดียว + เขียน InventoryMovement', async () => {
    const orderNumber = await createOrder(2);
    const before = await inventoryOf();

    const res = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth())
      .send({ provider: 'COD' });

    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('confirmed');
    expect(res.body.data.order.status).toBe('PROCESSING');
    // ยังไม่ได้รับเงิน — ห้ามบอกว่าจ่ายแล้ว
    expect(res.body.data.order.paymentStatus).toBe('PENDING');

    const after = await inventoryOf();
    expect(after.quantity).toBe(before.quantity - 2);
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);

    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });
    const movements = await prisma.inventoryMovement.findMany({
      where: { referenceType: 'ORDER', referenceId: order.id },
      select: { type: true, quantity: true, quantityBefore: true, quantityAfter: true },
    });

    expect(movements.length).toBe(1);
    expect(movements[0]!.type).toBe('STOCK_OUT');
    expect(movements[0]!.quantity).toBe(2);
    expect(movements[0]!.quantityAfter).toBe(movements[0]!.quantityBefore - 2);
  });

  it('กดยืนยันซ้ำ → 409 และไม่ตัดสต็อกซ้ำ', async () => {
    const orderNumber = await createOrder(1);

    const first = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth())
      .send({ provider: 'COD' });
    expect(first.status).toBe(200);

    const afterFirst = await inventoryOf();

    const second = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth())
      .send({ provider: 'COD' });

    expect(second.status).toBe(409);
    expect(await inventoryOf()).toEqual(afterFirst);
  });

  it('ออเดอร์ที่ยืนยัน COD แล้ว ยกเลิกไม่ได้ (409)', async () => {
    const orderNumber = await createOrder(1);
    await request(app).post(`/api/orders/${orderNumber}/pay`).set(auth()).send({ provider: 'COD' });

    const res = await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth());

    expect(res.status).toBe(409);
  });
});

describe('Stripe — ช่องทางที่ยังตั้งค่าไม่ครบ', () => {
  it('เลือก Stripe ตอนยังไม่มี key → 400 พร้อมบอกว่าต้องตั้งค่าอะไร (ไม่แกล้งจ่ายสำเร็จ)', async () => {
    const orderNumber = await createOrder(1);

    const res = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth())
      .send({ provider: 'STRIPE' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('STRIPE_SECRET_KEY');

    // ออเดอร์ต้องยังเป็นรอชำระเงินอยู่
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { status: true, paymentStatus: true },
    });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.paymentStatus).toBe('PENDING');
  });

  it('ช่องทางที่ไม่รู้จัก → 422', async () => {
    const orderNumber = await createOrder(1);

    const res = await request(app)
      .post(`/api/orders/${orderNumber}/pay`)
      .set(auth())
      .send({ provider: 'FREE_MONEY' });

    expect(res.status).toBe(422);
  });
});

describe('Stripe webhook', () => {
  it('ลายเซ็นผิด → 400 และไม่เปลี่ยนสถานะอะไร', async () => {
    const orderNumber = await createOrder(1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    const res = await postWebhook(
      sessionEvent('checkout.session.completed', order.id),
      /* badSignature */ true,
    );

    expect(res.status).toBe(400);

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { paymentStatus: true },
    });
    expect(after.paymentStatus).toBe('PENDING');
  });

  it('ไม่มีลายเซ็นมาเลย → 400', async () => {
    const res = await request(app)
      .post('/api/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
  });

  it('ลายเซ็นถูก + session สำเร็จ → ออเดอร์จ่ายแล้ว และตัดสต็อกจริง', async () => {
    const orderNumber = await createOrder(2);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });
    const before = await inventoryOf();

    const res = await postWebhook(sessionEvent('checkout.session.completed', order.id));

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('paid');

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paymentStatus: true, paidAt: true },
    });
    expect(after.status).toBe('PAID');
    expect(after.paymentStatus).toBe('PAID');
    expect(after.paidAt).not.toBeNull();

    const stock = await inventoryOf();
    expect(stock.quantity).toBe(before.quantity - 2);
    expect(stock.reservedQuantity).toBe(before.reservedQuantity - 2);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
      select: { status: true, provider: true, webhookEventId: true, rawPayload: true },
    });
    expect(payment.status).toBe('PAID');
    expect(payment.provider).toBe('STRIPE');
    expect(payment.webhookEventId).not.toBeNull();
    // ห้ามมีข้อมูลบัตรใน payload ที่เก็บไว้
    expect(JSON.stringify(payment.rawPayload)).not.toMatch(/card|cvc|number/i);
  });

  it('event เดิมยิงซ้ำ → ตรวจพบว่าซ้ำ และไม่ตัดสต็อกซ้ำ', async () => {
    const orderNumber = await createOrder(1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    const eventId = `evt_test_${randomUUID()}`;
    const event = sessionEvent('checkout.session.completed', order.id, { eventId });

    const first = await postWebhook(event);
    const afterFirst = await inventoryOf();

    const second = await postWebhook(event);
    const afterSecond = await inventoryOf();

    expect(first.body.data.duplicate).toBe(false);
    expect(second.body.data.duplicate).toBe(true);
    expect(afterSecond).toEqual(afterFirst);

    const movements = await prisma.inventoryMovement.count({
      where: { referenceType: 'ORDER', referenceId: order.id },
    });
    expect(movements).toBe(1);
  });

  it('event ใหม่แต่ผลเดิม (จ่ายแล้ว) → ไม่ตัดสต็อกซ้ำ', async () => {
    const orderNumber = await createOrder(1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    await postWebhook(sessionEvent('checkout.session.completed', order.id));
    const afterFirst = await inventoryOf();

    const res = await postWebhook(sessionEvent('checkout.session.completed', order.id));

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('ignored');
    expect(await inventoryOf()).toEqual(afterFirst);

    const movements = await prisma.inventoryMovement.count({
      where: { referenceType: 'ORDER', referenceId: order.id },
    });
    expect(movements).toBe(1);
  });

  it('session หมดอายุ → ยกเลิกออเดอร์และคืนของที่จองไว้', async () => {
    const orderNumber = await createOrder(2);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });
    const before = await inventoryOf();

    const res = await postWebhook(sessionEvent('checkout.session.expired', order.id));

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('cancelled');

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paymentStatus: true },
    });
    expect(after.status).toBe('CANCELLED');

    const stock = await inventoryOf();
    // ของกลับเข้าคลัง: quantity ไม่เปลี่ยน แต่ที่จองไว้ถูกปล่อย
    expect(stock.quantity).toBe(before.quantity);
    expect(stock.reservedQuantity).toBe(before.reservedQuantity - 2);
  });

  it('session หมดอายุของออเดอร์ที่จ่ายแล้ว → ไม่คืนของ (ของถูกตัดไปแล้ว)', async () => {
    const orderNumber = await createOrder(1);
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber },
      select: { id: true },
    });

    await postWebhook(sessionEvent('checkout.session.completed', order.id));
    const afterPaid = await inventoryOf();

    const res = await postWebhook(sessionEvent('checkout.session.expired', order.id));

    expect(res.body.data.action).toBe('ignored');
    expect(await inventoryOf()).toEqual(afterPaid);
  });

  it('event ที่ไม่เกี่ยวข้อง → ตอบ 200 แบบไม่ทำอะไร', async () => {
    const res = await postWebhook({
      id: `evt_test_${randomUUID()}`,
      object: 'event',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_test' } },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.action).toBe('ignored');
  });
});

describe('ยกเลิกคำสั่งซื้อที่ยังไม่ชำระเงิน', () => {
  it('ยกเลิกแล้วคืนของที่จองไว้เข้าคลัง', async () => {
    const orderNumber = await createOrder(2);
    const before = await inventoryOf();

    const res = await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');

    const after = await inventoryOf();
    expect(after.quantity).toBe(before.quantity);
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);
  });

  it('ยกเลิกซ้ำ → 409', async () => {
    const orderNumber = await createOrder(1);
    await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth());

    const res = await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth());

    expect(res.status).toBe(409);
  });

  it('ต้องล็อกอิน และเป็นออเดอร์ของตัวเอง', async () => {
    const orderNumber = await createOrder(1);

    const unauthenticated = await request(app).post(`/api/orders/${orderNumber}/cancel`);
    expect(unauthenticated.status).toBe(401);

    const crossSite = await request(app)
      .post(`/api/orders/${orderNumber}/cancel`)
      .set(auth())
      .set('Origin', 'http://evil.example.com');
    expect(crossSite.status).toBe(403);
  });
});

describe('GET /api/orders/:orderNumber/payment', () => {
  it('บอกสถานะ ช่องทางที่ใช้ได้ กำหนดชำระ และประวัติการชำระเงิน', async () => {
    const orderNumber = await createOrder(1);

    const res = await request(app).get(`/api/orders/${orderNumber}/payment`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.order.orderNumber).toBe(orderNumber);
    expect(res.body.data.payable).toBe(true);
    expect(res.body.data.expired).toBe(false);
    expect(new Date(res.body.data.deadline).getTime()).toBeGreaterThan(Date.now());
    expect(Array.isArray(res.body.data.attempts)).toBe(true);
  });

  it('หลังยืนยัน COD → จ่ายไม่ได้อีก และมีประวัติ 1 รายการ', async () => {
    const orderNumber = await createOrder(1);
    await request(app).post(`/api/orders/${orderNumber}/pay`).set(auth()).send({ provider: 'COD' });

    const res = await request(app).get(`/api/orders/${orderNumber}/payment`).set(auth());

    expect(res.body.data.payable).toBe(false);
    expect(res.body.data.attempts.length).toBe(1);
    expect(res.body.data.attempts[0].provider).toBe('COD');
  });
});
