import { createHmac, randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import {
  LOYALTY_TIERS,
  REDEEM_MINIMUM_POINTS,
  REDEEM_POINTS_PER_BAHT,
  REDEEM_STEP_POINTS,
} from '../src/config/loyalty.ts';
import { pointsEarnedFor, tierForSpend } from '../src/models/loyalty.model.ts';
import { PAID_ORDER_WHERE } from '../src/models/order.model.ts';
import { findUserIdsBySpendRange } from '../src/services/admin-customer.service.ts';
import {
  postPointTransaction,
  releasePointsForCancelledOrder,
} from '../src/services/loyalty.service.ts';
import { expireOverdueOrders } from '../src/services/payment.service.ts';

/**
 * Integration test ของแต้มสะสมกับเส้นทางเงินจริง (STEP 42)
 *
 * สิ่งที่ต้องพิสูจน์ (ทั้งหมดมีมูลค่าเท่าเงิน จึงยิงผ่าน HTTP กับฐานข้อมูลจริง):
 *   - ได้แต้ม **เมื่อร้านได้รับเงินจริง** เท่านั้น (Stripe webhook · COD ตอนส่งถึง) และได้ครั้งเดียว
 *   - ใช้แต้มเป็นส่วนลด: คิดที่ server · ยอดที่ client แนบมาถูกเมิน · ใช้ไม่ได้ต้องบอกเหตุผล
 *   - ยกเลิกทุกเส้นทางคืนแต้มที่ใช้ · ยกเลิกใบที่จ่ายแล้วหักแต้มที่ได้ (หักได้ไม่เกินยอดคงเหลือ)
 *   - แต้มไม่ติดลบแม้สองคำสั่งซื้อแย่งกันพร้อมกัน
 *   - ร้านปรับแต้ม: สิทธิ์ · เหตุผล · AdminLog · กันกดซ้ำ
 *   - **ยอดคงเหลือ = ผลรวมของสมุดแต้มเสมอ**
 *
 * ⚠️ ตัวเลขที่คาดไว้อ้างจาก config/loyalty.ts และ models/loyalty.model.ts
 *    ไม่ได้พิมพ์ซ้ำในเทสต์ (กฎ STEP 40 ข้อ 2)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET']!;

interface TestUser {
  id: string;
  token: string;
  email: string;
}

let buyer: TestUser;
let other: TestUser;
let admin: TestUser;
let otherAdmin: TestUser;
let employee: TestUser;
let variantId = '';

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];

const ADDRESS = {
  recipientName: 'ผู้รับทดสอบแต้ม',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

async function createUser(
  role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN',
  label: string,
): Promise<TestUser> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const email = `test-loyalty-${label}-${suffix}@teenstyle.test`;
  const user = await prisma.user.create({ data: { email, roleId: roleRow.id } });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token, email };
}

/** เติมแต้มผ่านตัวเขียนจริง (ADJUSTMENT) — ไม่แตะคอลัมน์ points ตรง ๆ */
async function grant(user: TestUser, points: number): Promise<void> {
  await prisma.$transaction((tx) =>
    postPointTransaction(tx, {
      userId: user.id,
      type: 'ADJUSTMENT',
      delta: points,
      description: 'เติมแต้มสำหรับเทสต์',
      idempotencyKey: `test:${randomUUID()}`,
    }),
  );
}

const pointsOf = async (user: TestUser) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true } }))
    .points;

/** ใส่ของลงตะกร้าแล้วสั่งซื้อ — คืน response ของการสร้างออเดอร์ */
async function orderWith(user: TestUser, body: Record<string, unknown> = {}) {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
  await request(app).post('/api/cart/items').set(auth(user)).send({ variantId, quantity: 1 });

  const response = await request(app)
    .post('/api/orders')
    .set(auth(user))
    .send({
      idempotencyKey: randomUUID(),
      shippingMethod: 'STANDARD',
      newAddress: ADDRESS,
      ...body,
    });

  if (response.status === 201) createdOrderIds.push(response.body.data.id);

  return response;
}

/** สั่งซื้อแล้วคืนแถวออเดอร์ที่ต้องใช้ — ล้มทันทีถ้าสั่งไม่สำเร็จ */
async function placeOrder(user: TestUser, body: Record<string, unknown> = {}) {
  const response = await orderWith(user, body);

  expect(response.status).toBe(201);

  return prisma.order.findUniqueOrThrow({
    where: { id: response.body.data.id },
    select: {
      id: true,
      orderNumber: true,
      subtotal: true,
      discountTotal: true,
      pointsRedeemed: true,
      pointsDiscount: true,
      shippingFee: true,
      total: true,
    },
  });
}

/** payload + ลายเซ็นแบบเดียวกับที่ Stripe ส่งมา (secret ปลอมจาก tests/setup.ts) */
function postPaidWebhook(orderId: string) {
  const event = {
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
  };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');

  return request(app)
    .post('/api/payments/webhook/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', `t=${timestamp},v1=${digest}`)
    .send(body);
}

/** ยอดที่จ่ายจริงสะสม — ใส่คำสั่งซื้อที่จ่ายแล้วตรง ๆ เพื่อกำหนดระดับตั้งต้น */
async function seedPaidSpend(user: TestUser, amount: number): Promise<void> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-${suffix}-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      subtotal: amount,
      total: amount,
      addressSnapshot: {},
      paidAt: new Date(),
    },
    select: { id: true },
  });

  createdOrderIds.push(order.id);
}

const earnRowsOf = (orderId: string) =>
  prisma.pointTransaction.findMany({ where: { orderId, type: 'EARN' } });

beforeAll(async () => {
  buyer = await createUser('CUSTOMER', 'buyer');
  other = await createUser('CUSTOMER', 'other');
  admin = await createUser('ADMIN', 'admin');
  otherAdmin = await createUser('ADMIN', 'admin2');
  employee = await createUser('EMPLOYEE', 'staff');

  const row = await prisma.productVariant.findFirstOrThrow({
    where: {
      isActive: true,
      deletedAt: null,
      product: { status: 'ACTIVE', deletedAt: null },
      inventory: { quantity: { gt: 12 } },
    },
    // เทสต์นี้สั่งซื้อราว 10 ใบ (บางใบตัดสต็อกจริงชั่วคราว) — เลือกตัวที่มีของมากที่สุด
    orderBy: { inventory: { quantity: 'desc' } },
    select: { id: true },
  });

  variantId = row.id;
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
});

afterAll(async () => {
  // ของที่ยังถูกจองโดยออเดอร์ PENDING_PAYMENT ต้องคืนก่อนลบ (บทเรียนจาก STEP 41)
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

  // คืนสต็อกตาม movement ที่เทสต์นี้สร้าง (ตัดออกตอนจ่ายเงิน − รับคืนตอนยกเลิก)
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
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  // PointTransaction / Notification ลบตามผู้ใช้ (onDelete: Cascade)
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await disconnectDatabase();
});

/* ═══════════════════════════ ได้แต้ม ═══════════════════════════ */

describe('ได้แต้มเมื่อร้านได้รับเงินจริงเท่านั้น', () => {
  it('สั่งซื้อแล้วยังไม่จ่าย = ยังไม่ได้แต้ม · Stripe ยืนยันแล้วได้แต้มตามยอดที่จ่ายจริง', async () => {
    const earner = await createUser('CUSTOMER', 'earner');
    const order = await placeOrder(earner);

    expect(await pointsOf(earner)).toBe(0);
    expect(await earnRowsOf(order.id)).toHaveLength(0);

    const paid = await postPaidWebhook(order.id);
    expect(paid.status).toBe(200);

    const expected = pointsEarnedFor(Number(order.total), tierForSpend(0));
    const rows = await earnRowsOf(order.id);

    expect(expected).toBeGreaterThan(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delta).toBe(expected);
    expect(await pointsOf(earner)).toBe(expected);

    // หน้าคำสั่งซื้อบอกแต้มที่ได้ · แจ้งเตือน "ชำระเงินสำเร็จ" บอกแต้มรวมไปในรายการเดียว
    const detail = await request(app).get(`/api/orders/${order.orderNumber}`).set(auth(earner));
    expect(detail.body.data.pointsEarned).toBe(expected);

    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: earner.id, type: 'PAYMENT_SUCCESS' },
    });
    expect(notice.body).toContain(`${expected.toLocaleString('th-TH')} แต้ม`);

    // webhook ยิงซ้ำ (event id ใหม่) → ไม่ได้แต้มเพิ่ม
    await postPaidWebhook(order.id);
    expect(await earnRowsOf(order.id)).toHaveLength(1);
    expect(await pointsOf(earner)).toBe(expected);
  });

  it('COD ได้แต้มตอนกด "ส่งถึง" (จุดที่ได้เงิน) ไม่ใช่ตอนยืนยันคำสั่งซื้อ', async () => {
    const codBuyer = await createUser('CUSTOMER', 'cod');
    const order = await placeOrder(codBuyer);

    const pay = await request(app)
      .post(`/api/orders/${order.orderNumber}/pay`)
      .set(auth(codBuyer))
      .send({ provider: 'COD' });
    expect(pay.status).toBe(200);
    expect(await pointsOf(codBuyer)).toBe(0);

    const steps = [
      { status: 'PACKING' },
      { status: 'SHIPPING', carrier: 'Kerry Express', trackingNumber: `TEST${suffix}` },
      { status: 'DELIVERED' },
    ];

    for (const step of steps) {
      const response = await request(app)
        .patch(`/api/admin/orders/${order.orderNumber}/status`)
        .set(auth(admin))
        .send(step);

      expect(response.status).toBe(200);
      if (step.status !== 'DELIVERED') expect(await pointsOf(codBuyer)).toBe(0);
    }

    const expected = pointsEarnedFor(Number(order.total), tierForSpend(0));
    expect(await pointsOf(codBuyer)).toBe(expected);

    // COD ได้เงินตอนของถึงมือแล้ว — ข้อความต้องไม่บอกว่า "กำลังเตรียมจัดส่ง"
    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: codBuyer.id, type: 'PAYMENT_SUCCESS' },
    });
    expect(notice.body).not.toContain('เตรียมจัดส่ง');
  });
});

/* ═══════════════════════════ ระดับสมาชิก ═══════════════════════════ */

describe('ระดับสมาชิกคิดจากยอดที่จ่ายจริง', () => {
  it('ใบที่ทำให้ขึ้นระดับยังได้ตัวคูณเดิม · ใบถัดไปได้ตัวคูณใหม่ · แจ้งเตือนขึ้นระดับครั้งเดียว', async () => {
    const climber = await createUser('CUSTOMER', 'climber');
    const second = LOYALTY_TIERS[1]!;
    const seed = second.minSpend - 1;

    await seedPaidSpend(climber, seed);

    const first = await placeOrder(climber);
    await postPaidWebhook(first.id);

    const firstTotal = Number(first.total);
    const [firstEarn] = await earnRowsOf(first.id);
    expect(firstEarn!.delta).toBe(pointsEarnedFor(firstTotal, tierForSpend(seed)));

    const secondOrder = await placeOrder(climber);
    await postPaidWebhook(secondOrder.id);

    const [secondEarn] = await earnRowsOf(secondOrder.id);
    const tierForSecond = tierForSpend(seed + firstTotal);

    expect(tierForSecond.code).toBe(second.code);
    expect(secondEarn!.delta).toBe(pointsEarnedFor(Number(secondOrder.total), tierForSecond));

    const loyalty = await request(app).get('/api/users/me/loyalty').set(auth(climber));
    const spend = seed + firstTotal + Number(secondOrder.total);

    expect(loyalty.status).toBe(200);
    expect(loyalty.body.data.lifetimeSpend).toBe(spend);
    expect(loyalty.body.data.tier.code).toBe(tierForSpend(spend).code);
    expect(loyalty.body.data.points).toBe(firstEarn!.delta + secondEarn!.delta);
    // กติกาที่หน้าเว็บอธิบายมาจาก config ตัวเดียวกับที่คิดจริง
    expect(loyalty.body.data.rules.redeemMinimumPoints).toBe(REDEEM_MINIMUM_POINTS);

    const upgrades = await prisma.notification.findMany({
      where: { userId: climber.id, type: 'LOYALTY_UPDATE' },
    });
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]!.title).toContain(second.name);
  });

  it('ตัวกรองระดับในหลังบ้านใช้เกณฑ์เดียวกับยอดที่ได้รับ (SQL กับ Prisma ต้องตรงกัน)', async () => {
    const ids = createdUserIds;

    for (const userId of ids) {
      const aggregate = await prisma.order.aggregate({
        where: { ...PAID_ORDER_WHERE, userId },
        _sum: { total: true },
      });
      const spend = Number(aggregate._sum.total ?? 0);

      if (spend === 0) continue;

      // ช่วงที่ครอบยอดพอดีต้องเจอ · ช่วงที่เริ่มสูงกว่า 1 สตางค์ต้องไม่เจอ
      expect(await findUserIdsBySpendRange(spend, spend + 0.01)).toContain(userId);
      expect(await findUserIdsBySpendRange(spend + 0.01, null)).not.toContain(userId);
    }

    const climberEmail = `test-loyalty-climber-${suffix}@teenstyle.test`;
    const climber = await prisma.user.findUniqueOrThrow({ where: { email: climberEmail } });
    const spend = Number(
      (
        await prisma.order.aggregate({
          where: { ...PAID_ORDER_WHERE, userId: climber.id },
          _sum: { total: true },
        })
      )._sum.total,
    );
    const tier = tierForSpend(spend);
    const otherTier = LOYALTY_TIERS.find((item) => item.code !== tier.code)!;

    const match = await request(app)
      .get(`/api/admin/customers?tier=${tier.code}&q=${encodeURIComponent(climberEmail)}`)
      .set(auth(employee));
    const miss = await request(app)
      .get(`/api/admin/customers?tier=${otherTier.code}&q=${encodeURIComponent(climberEmail)}`)
      .set(auth(employee));

    expect(match.body.data.items.map((item: { id: string }) => item.id)).toEqual([climber.id]);
    expect(match.body.data.items[0].tier.code).toBe(tier.code);
    expect(miss.body.data.items).toHaveLength(0);
  });
});

/* ═══════════════════════════ ใช้แต้ม ═══════════════════════════ */

describe('ใช้แต้มเป็นส่วนลดตอนสั่งซื้อ', () => {
  it('หน้าสรุปยอดคิดส่วนลดจากแต้มที่ server · ขอผิดเงื่อนไขได้เหตุผล ไม่ลดให้เงียบ ๆ', async () => {
    await grant(buyer, REDEEM_MINIMUM_POINTS * 10);
    await request(app).post('/api/cart/items').set(auth(buyer)).send({ variantId, quantity: 1 });

    const ok = await request(app)
      .get(`/api/checkout/summary?pointsToRedeem=${REDEEM_MINIMUM_POINTS}`)
      .set(auth(buyer));
    const data = ok.body.data;
    const discount = REDEEM_MINIMUM_POINTS / REDEEM_POINTS_PER_BAHT;

    expect(ok.status).toBe(200);
    expect(data.loyalty.appliedPoints).toBe(REDEEM_MINIMUM_POINTS);
    expect(data.loyalty.pointsDiscount).toBe(discount);
    expect(data.loyalty.error).toBeNull();
    expect(data.discountTotal).toBe(data.couponDiscount + discount);
    expect(data.total).toBe(data.subtotal - data.discountTotal + data.shippingFee);

    const bad = await request(app)
      .get(`/api/checkout/summary?pointsToRedeem=${REDEEM_MINIMUM_POINTS + 1}`)
      .set(auth(buyer));

    expect(bad.body.data.loyalty.appliedPoints).toBe(0);
    expect(bad.body.data.loyalty.pointsDiscount).toBe(0);
    expect(bad.body.data.loyalty.error).toContain(String(REDEEM_STEP_POINTS));
    expect(bad.body.data.total).toBe(bad.body.data.subtotal + bad.body.data.shippingFee);
  });

  it('สั่งซื้อพร้อมใช้แต้ม: หักทันที บันทึกลงบิล · ยอดที่ client แนบมาถูกเมิน', async () => {
    const before = await pointsOf(buyer);
    const order = await placeOrder(buyer, {
      pointsToRedeem: REDEEM_MINIMUM_POINTS,
      // SECURITY: client ส่งได้แค่จำนวนแต้ม — มูลค่าและยอดที่แนบมาต้องถูกเมิน
      pointsDiscount: 99_999,
      discountTotal: 99_999,
      total: 1,
    });
    const discount = REDEEM_MINIMUM_POINTS / REDEEM_POINTS_PER_BAHT;

    expect(order.pointsRedeemed).toBe(REDEEM_MINIMUM_POINTS);
    expect(Number(order.pointsDiscount)).toBe(discount);
    expect(Number(order.discountTotal)).toBe(discount);
    expect(Number(order.total)).toBe(
      Number(order.subtotal) - Number(order.discountTotal) + Number(order.shippingFee),
    );
    expect(await pointsOf(buyer)).toBe(before - REDEEM_MINIMUM_POINTS);

    const redeem = await prisma.pointTransaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'REDEEM' },
    });
    expect(redeem.delta).toBe(-REDEEM_MINIMUM_POINTS);
    expect(redeem.description).toContain(order.orderNumber);
  });

  it('แต้มไม่พอ → 400 · ไม่มีคำสั่งซื้อ ไม่มีของถูกจอง ไม่มีแต้มหาย', async () => {
    const balance = await pointsOf(buyer);
    const ordersBefore = await prisma.order.count({ where: { userId: buyer.id } });
    const reservedBefore = (await prisma.inventory.findUniqueOrThrow({ where: { variantId } }))
      .reservedQuantity;

    const tooMany =
      Math.ceil((balance + REDEEM_MINIMUM_POINTS) / REDEEM_STEP_POINTS) * REDEEM_STEP_POINTS;
    const response = await orderWith(buyer, { pointsToRedeem: tooMany });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('แต้มไม่พอ');
    expect(await prisma.order.count({ where: { userId: buyer.id } })).toBe(ordersBefore);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { variantId } })).reservedQuantity,
    ).toBe(reservedBefore);
    expect(await pointsOf(buyer)).toBe(balance);
  });

  it('ยกเลิกคำสั่งซื้อที่ยังไม่จ่าย → แต้มที่ใช้ได้คืนครบ และคืนซ้ำไม่ได้', async () => {
    const before = await pointsOf(buyer);
    const order = await placeOrder(buyer, { pointsToRedeem: REDEEM_MINIMUM_POINTS });

    expect(await pointsOf(buyer)).toBe(before - REDEEM_MINIMUM_POINTS);

    const cancel = await request(app)
      .post(`/api/orders/${order.orderNumber}/cancel`)
      .set(auth(buyer));

    expect(cancel.status).toBe(200);
    expect(await pointsOf(buyer)).toBe(before);

    // เรียกซ้ำ (เช่น webhook มาทีหลัง) ต้องไม่คืนสองเท่า
    const again = await prisma.$transaction((tx) => releasePointsForCancelledOrder(tx, order.id));

    expect(again).toEqual({ refunded: 0, reversed: 0 });
    expect(await pointsOf(buyer)).toBe(before);
  });

  it('หมดเวลาชำระเงิน → แต้มที่ใช้ได้คืน', async () => {
    const before = await pointsOf(buyer);
    const order = await placeOrder(buyer, { pointsToRedeem: REDEEM_MINIMUM_POINTS });

    // ย้อนเวลาสร้างไปเกินเพดานสูงสุดของ PAYMENT_WINDOW_MINUTES (7 วัน)
    await prisma.order.update({
      where: { id: order.id },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    await expireOverdueOrders();

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
    expect(await pointsOf(buyer)).toBe(before);
  });

  it('สองรายการแย่งแต้มก้อนเดียวกันพร้อมกัน → สำเร็จรายเดียว แต้มไม่ติดลบ', async () => {
    const racer = await createUser('CUSTOMER', 'racer');
    await grant(racer, REDEEM_MINIMUM_POINTS);

    const attempt = () =>
      prisma.$transaction((tx) =>
        postPointTransaction(tx, {
          userId: racer.id,
          type: 'REDEEM',
          delta: -REDEEM_MINIMUM_POINTS,
          description: 'แย่งใช้แต้มพร้อมกัน',
          idempotencyKey: `test:${randomUUID()}`,
        }),
      );

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await pointsOf(racer)).toBe(0);
    expect(
      await prisma.pointTransaction.count({ where: { userId: racer.id, type: 'REDEEM' } }),
    ).toBe(1);
  });
});

/* ═══════════════════════ ยกเลิกใบที่จ่ายแล้ว ═══════════════════════ */

describe('ร้านยกเลิกคำสั่งซื้อที่จ่ายแล้ว', () => {
  it('คืนแต้มที่ใช้ + หักแต้มที่ได้คืน · ยอดสะสมไม่นับใบนี้อีก', async () => {
    const refunder = await createUser('CUSTOMER', 'refunder');
    const granted = REDEEM_MINIMUM_POINTS * 2;

    await grant(refunder, granted);

    const order = await placeOrder(refunder, { pointsToRedeem: REDEEM_MINIMUM_POINTS });
    await postPaidWebhook(order.id);

    const [earn] = await earnRowsOf(order.id);
    expect(await pointsOf(refunder)).toBe(granted - REDEEM_MINIMUM_POINTS + earn!.delta);

    const cancel = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin))
      .send({ status: 'CANCELLED' });

    expect(cancel.status).toBe(200);
    expect(await pointsOf(refunder)).toBe(granted);

    const detail = await request(app).get(`/api/orders/${order.orderNumber}`).set(auth(refunder));
    expect(detail.body.data.pointsEarned).toBe(0);

    const loyalty = await request(app).get('/api/users/me/loyalty').set(auth(refunder));
    expect(loyalty.body.data.lifetimeSpend).toBe(0);
  });

  it('แต้มที่ได้ถูกใช้ไปแล้ว → หักได้เท่าที่มี บันทึกตรง ๆ ว่าขาดเท่าไร และการยกเลิกไม่ล้ม', async () => {
    const spender = await createUser('CUSTOMER', 'spender');
    const order = await placeOrder(spender);
    await postPaidWebhook(order.id);

    const [earn] = await earnRowsOf(order.id);
    expect(earn!.delta).toBeGreaterThan(1);

    // ใช้แต้มไปเกือบหมด เหลือ 1 แต้ม
    await prisma.$transaction((tx) =>
      postPointTransaction(tx, {
        userId: spender.id,
        type: 'REDEEM',
        delta: -(earn!.delta - 1),
        description: 'ใช้แต้มในคำสั่งซื้ออื่น',
        idempotencyKey: `test:${randomUUID()}`,
      }),
    );

    const cancel = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin))
      .send({ status: 'CANCELLED' });

    expect(cancel.status).toBe(200);
    expect(await pointsOf(spender)).toBe(0);

    const reversal = await prisma.pointTransaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'EARN_REVERSAL' },
    });
    expect(reversal.delta).toBe(-1);
    expect(reversal.description).toContain('หักได้ 1 แต้ม');
  });
});

/* ═══════════════════════════ ร้านปรับแต้ม ═══════════════════════════ */

describe('ร้านปรับแต้ม (loyalty:adjust)', () => {
  const adjust = (actor: TestUser, target: TestUser, body: Record<string, unknown>) =>
    request(app).post(`/api/admin/customers/${target.id}/points`).set(auth(actor)).send(body);

  it('พนักงานดูประวัติแต้มได้ แต่ปรับไม่ได้ (403)', async () => {
    const list = await request(app)
      .get(`/api/admin/customers/${buyer.id}/points`)
      .set(auth(employee));
    const denied = await adjust(employee, buyer, {
      delta: 10,
      reason: 'พนักงานลองให้แต้ม',
      idempotencyKey: randomUUID(),
    });

    expect(list.status).toBe(200);
    expect(list.body.data.standing.points).toBe(await pointsOf(buyer));
    expect(denied.status).toBe(403);
  });

  it('ไม่กรอกเหตุผล → 422 พร้อมข้อความไทย · delta = 0 → 422', async () => {
    const noReason = await adjust(admin, buyer, { delta: 10, idempotencyKey: randomUUID() });
    const zero = await adjust(admin, buyer, {
      delta: 0,
      reason: 'ไม่ได้ปรับอะไร',
      idempotencyKey: randomUUID(),
    });

    expect(noReason.status).toBe(422);
    expect(JSON.stringify(noReason.body.details)).toContain('เหตุผล');
    expect(zero.status).toBe(422);
  });

  it('ADMIN ปรับได้ · เขียน AdminLog · ลูกค้าได้รับแจ้งพร้อมเหตุผล · กดซ้ำไม่ปรับซ้ำ', async () => {
    const before = await pointsOf(buyer);
    const body = {
      delta: 50,
      reason: 'ชดเชยพัสดุล่าช้า',
      idempotencyKey: randomUUID(),
    };

    const first = await adjust(admin, buyer, body);
    const replay = await adjust(admin, buyer, body);

    expect(first.status).toBe(200);
    expect(first.body.data.applied).toBe(true);
    expect(first.body.data.standing.points).toBe(before + 50);
    expect(replay.body.data.applied).toBe(false);
    expect(await pointsOf(buyer)).toBe(before + 50);

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { userId: admin.id, action: 'customer.points.adjust', targetId: buyer.id },
    });
    expect(log.before).toEqual({ points: before });
    expect(log.after).toMatchObject({ points: before + 50, reason: body.reason });

    const notice = await prisma.notification.findFirstOrThrow({
      where: { userId: buyer.id, type: 'LOYALTY_UPDATE' },
    });
    expect(notice.body).toContain(body.reason);

    const list = await request(app)
      .get(`/api/admin/customers/${buyer.id}/points`)
      .set(auth(employee));
    expect(list.body.data.items[0].createdBy.id).toBe(admin.id);
  });

  it('หักเกินยอดคงเหลือ → 409 และยอดไม่เปลี่ยน', async () => {
    const balance = await pointsOf(buyer);
    const response = await adjust(admin, buyer, {
      delta: -(balance + 1),
      reason: 'หักเกินยอด',
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect(await pointsOf(buyer)).toBe(balance);
  });

  it('ปรับแต้มของตัวเองไม่ได้ (400) · ปรับแต้มของ ADMIN ด้วยกันไม่ได้ (403)', async () => {
    const self = await adjust(admin, admin, {
      delta: 1_000,
      reason: 'ให้แต้มตัวเอง',
      idempotencyKey: randomUUID(),
    });
    const peer = await adjust(admin, otherAdmin, {
      delta: 1_000,
      reason: 'ให้แต้มเพื่อนแอดมิน',
      idempotencyKey: randomUUID(),
    });

    expect(self.status).toBe(400);
    expect(peer.status).toBe(403);
    expect(await pointsOf(admin)).toBe(0);
    expect(await pointsOf(otherAdmin)).toBe(0);
  });
});

/* ═══════════════════════════ ความเป็นเจ้าของ ═══════════════════════════ */

describe('ประวัติแต้มเป็นของเจ้าของบัญชีเท่านั้น', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้าเห็นแค่รายการของตัวเอง', async () => {
    const anonymous = await request(app).get('/api/users/me/loyalty/transactions');
    expect(anonymous.status).toBe(401);

    const buyerRows = await prisma.pointTransaction.findMany({
      where: { userId: buyer.id },
      select: { id: true },
    });
    const otherView = await request(app)
      .get('/api/users/me/loyalty/transactions?limit=50')
      .set(auth(other));

    expect(buyerRows.length).toBeGreaterThan(0);
    expect(otherView.status).toBe(200);
    expect(otherView.body.data.total).toBe(0);

    const mine = await request(app)
      .get('/api/users/me/loyalty/transactions?limit=50')
      .set(auth(buyer));
    const ids = mine.body.data.items.map((item: { id: string }) => item.id);

    expect(ids.sort()).toEqual(buyerRows.map((row) => row.id).sort());
  });
});

/* ═══════════════════ ยอดคงเหลือ = ผลรวมของสมุดแต้ม ═══════════════════ */

describe('ยอดคงเหลืออธิบายได้ด้วยประวัติเสมอ', () => {
  it('ทุกบัญชีในเทสต์นี้: points = SUM(delta) และ balanceBefore ต่อจาก balanceAfter ของรายการก่อน', async () => {
    for (const userId of createdUserIds) {
      const [user, rows] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } }),
        prisma.pointTransaction.findMany({
          where: { userId },
          orderBy: { sequence: 'asc' },
        }),
      ]);

      expect(rows.reduce((sum, row) => sum + row.delta, 0)).toBe(user.points);

      let running = 0;
      for (const row of rows) {
        expect(row.balanceBefore).toBe(running);
        running = row.balanceAfter;
      }
    }
  });
});
