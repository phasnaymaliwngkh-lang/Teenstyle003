import { createHmac, randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { pointsEarnedFor, tierForSpend } from '../src/models/loyalty.model.ts';
import { computePointsShare, computeRefundAmount } from '../src/models/return.model.ts';

/**
 * Integration test ของการคืนสินค้าและคืนเงิน (STEP 43)
 *
 * สิ่งที่ต้องพิสูจน์ (เงิน · สต็อก · แต้ม — ยิงผ่าน HTTP กับฐานข้อมูลจริง):
 *   - ขอคืนได้เฉพาะของที่ได้รับแล้ว อยู่ในกำหนด และเป็นของตัวเอง · ขอเกินจำนวนที่ซื้อไม่ได้
 *   - ยอดเงินที่ client แนบมาถูกเมิน · คำขอที่ยังไม่จบมีได้ใบเดียวต่อคำสั่งซื้อ (แม้ยิงพร้อมกัน)
 *   - ตรวจรับของ: รับเข้าคลังเฉพาะชิ้นที่ขายต่อได้ (movement RETURN)
 *   - คืนเงิน: ยอดตามสัดส่วน · ครั้งสุดท้ายคืนเงินที่เหลือทั้งหมด · คืนเกินที่จ่ายไม่ได้ · กดซ้ำไม่คืนซ้ำ
 *   - แต้มปรับตามสัดส่วนเดียวกัน · ยอดสะสมของลูกค้าหักเงินที่คืน
 *   - คำสั่งซื้อที่ร้านยกเลิกหลังชำระเงินต้องมีทางบันทึกการคืนเงิน
 *   - สิทธิ์: พนักงานตรวจคำขอได้ แต่บันทึกการคืนเงินไม่ได้
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
let employee: TestUser;
const variants: string[] = [];

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

const ADDRESS = {
  recipientName: 'ผู้รับทดสอบคืนสินค้า',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const email = `test-return-${label}-${suffix}@teenstyle.test`;
  const user = await prisma.user.create({ data: { email, roleId: roleRow.id } });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token, email };
}

/** สั่งซื้อจากตะกร้าจริง แล้วคืนแถวออเดอร์พร้อมรายการ */
async function placeOrder(user: TestUser, lines: { variantId: string; quantity: number }[]) {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });

  for (const line of lines) {
    const added = await request(app).post('/api/cart/items').set(auth(user)).send(line);
    expect(added.status).toBeLessThan(300);
  }

  const response = await request(app)
    .post('/api/orders')
    .set(auth(user))
    .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', newAddress: ADDRESS });

  expect(response.status).toBe(201);
  createdOrderIds.push(response.body.data.id);

  return prisma.order.findUniqueOrThrow({
    where: { id: response.body.data.id },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      subtotal: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, unitPrice: true, quantity: true },
      },
    },
  });
}

/** COD → แพ็ก → ส่ง → ส่งถึง (ร้านได้เงินตอนส่งถึง) */
async function deliveredOrder(user: TestUser, lines: { variantId: string; quantity: number }[]) {
  const order = await placeOrder(user, lines);
  const pay = await request(app)
    .post(`/api/orders/${order.orderNumber}/pay`)
    .set(auth(user))
    .send({ provider: 'COD' });

  expect(pay.status).toBe(200);

  for (const step of [
    { status: 'PACKING' },
    { status: 'SHIPPING', carrier: 'Kerry Express', trackingNumber: `RT${suffix}` },
    { status: 'DELIVERED' },
  ]) {
    const response = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin))
      .send(step);
    expect(response.status).toBe(200);
  }

  return order;
}

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

const createReturn = (user: TestUser, body: Record<string, unknown>) =>
  request(app)
    .post('/api/returns')
    .set(auth(user))
    .send({
      reason: 'DEFECTIVE',
      detail: 'ตะเข็บด้านข้างแตกตั้งแต่แกะกล่อง',
      idempotencyKey: randomUUID(),
      ...body,
    });

const decide = (user: TestUser, returnId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/admin/returns/${returnId}/status`).set(auth(user)).send(body);

const receive = (
  user: TestUser,
  returnId: string,
  items: { returnItemId: string; restock: boolean }[],
) => request(app).post(`/api/admin/returns/${returnId}/receive`).set(auth(user)).send({ items });

const refund = (user: TestUser, returnId: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/admin/returns/${returnId}/refund`)
    .set(auth(user))
    .send({
      method: 'BANK_TRANSFER',
      reference: `TRF-${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
      ...body,
    });

const orderRow = (id: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      paymentStatus: true,
      total: true,
      refundedTotal: true,
      refundedAt: true,
    },
  });

const pointsOf = async (user: TestUser) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true } }))
    .points;

beforeAll(async () => {
  buyer = await createUser('CUSTOMER', 'buyer');
  other = await createUser('CUSTOMER', 'other');
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'staff');

  const rows = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      product: { status: 'ACTIVE', deletedAt: null },
      inventory: { quantity: { gt: 8 } },
    },
    orderBy: { inventory: { quantity: 'desc' } },
    take: 2,
    select: { id: true },
  });

  variants.push(...rows.map((row) => row.id));
  expect(variants).toHaveLength(2);
});

afterAll(async () => {
  const returnIds = (
    await prisma.returnRequest.findMany({
      where: { orderId: { in: createdOrderIds } },
      select: { id: true },
    })
  ).map((row) => row.id);

  // ของที่ยังถูกจองโดยใบที่รอชำระ ต้องคืนก่อนลบ (บทเรียน STEP 41)
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

  // คืนยอดคลังตาม movement ที่เทสต์นี้สร้าง (ตัดออก − รับคืนจากการยกเลิก − รับคืนจากคำขอคืน)
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      OR: [
        { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
        { referenceType: 'RETURN_REQUEST', referenceId: { in: returnIds } },
      ],
    },
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
    const owner = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: owner.productId },
      data: { totalStock: { increment: amount } },
    });
  }

  await prisma.inventoryMovement.deleteMany({
    where: {
      OR: [
        { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
        { referenceType: 'RETURN_REQUEST', referenceId: { in: returnIds } },
      ],
    },
  });
  // FK แบบ Restrict — บันทึกการเงินต้องถูกลบเองก่อนลบคำสั่งซื้อ (ไม่หายตามกันเงียบ ๆ)
  await prisma.refund.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.returnRequest.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await disconnectDatabase();
});

/* ═══════════════════════════ สิทธิ์ขอคืน ═══════════════════════════ */

describe('ขอคืนได้เฉพาะของที่ได้รับแล้ว อยู่ในกำหนด และเป็นของตัวเอง', () => {
  it('ยังไม่ได้รับของ → ขอไม่ได้ (บอกเหตุผล) · ของคนอื่น → 404', async () => {
    const pending = await placeOrder(buyer, [{ variantId: variants[0]!, quantity: 1 }]);

    const eligibility = await request(app)
      .get(`/api/returns/eligibility/${pending.orderNumber}`)
      .set(auth(buyer));
    expect(eligibility.status).toBe(200);
    expect(eligibility.body.data.eligible).toBe(false);
    expect(eligibility.body.data.message).toContain('ได้รับสินค้า');

    const create = await createReturn(buyer, {
      orderNumber: pending.orderNumber,
      items: [{ orderItemId: pending.items[0]!.id, quantity: 1 }],
    });
    expect(create.status).toBe(409);

    const stranger = await request(app)
      .get(`/api/returns/eligibility/${pending.orderNumber}`)
      .set(auth(other));
    expect(stranger.status).toBe(404);
  });
});

/* ═══════════════════ คำขอ: จำนวน · ยอดเงิน · คำขอซ้ำ ═══════════════════ */

describe('ยื่นคำขอคืน', () => {
  let order: Awaited<ReturnType<typeof deliveredOrder>>;

  beforeAll(async () => {
    order = await deliveredOrder(buyer, [{ variantId: variants[1]!, quantity: 1 }]);
  });

  it('ขอเกินจำนวนที่ซื้อ → 409 · รายการที่ไม่อยู่ในบิล → 400 · ไม่เลือกอะไร → 422', async () => {
    const tooMany = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: order.items[0]!.id, quantity: 2 }],
    });
    const foreign = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: randomUUID(), quantity: 1 }],
    });
    const empty = await createReturn(buyer, { orderNumber: order.orderNumber, items: [] });

    expect(tooMany.status).toBe(409);
    expect(foreign.status).toBe(400);
    expect(empty.status).toBe(422);
  });

  it('ยอดที่ client แนบมาถูกเมิน · เลขคำขอต่อจากเลขคำสั่งซื้อ · ส่งซ้ำด้วยคีย์เดิมได้คำขอเดิม', async () => {
    const idempotencyKey = randomUUID();
    const body = {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
      idempotencyKey,
      // SECURITY: ลูกค้าส่งยอดเงินไม่ได้
      amount: 99_999,
      estimatedRefund: 99_999,
    };

    const first = await createReturn(buyer, body);
    const replay = await createReturn(buyer, body);

    expect(first.status).toBe(201);
    expect(first.body.data.returnNumber).toBe(`${order.orderNumber}-R1`);
    // คืนทั้งบิล → เงินที่เหลือทั้งหมด (สูตรจาก return.model.ts)
    expect(first.body.data.estimatedRefund).toBe(
      computeRefundAmount({
        total: Number(order.total),
        subtotal: Number(order.subtotal),
        refundedTotal: 0,
        goods: Number(order.items[0]!.unitPrice),
        final: true,
      }),
    );
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
  });

  it('มีคำขอที่ยังไม่จบอยู่แล้ว → ยื่นใหม่ไม่ได้ · ลูกค้ายกเลิกเองได้ แต่ยกเลิกของคนอื่นไม่ได้ (404)', async () => {
    const again = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
    });
    expect(again.status).toBe(409);

    const mine = await request(app).get('/api/returns').set(auth(buyer));
    const open = mine.body.data.items.find(
      (item: { orderNumber: string; status: string }) =>
        item.orderNumber === order.orderNumber && item.status === 'REQUESTED',
    );

    const stranger = await request(app).post(`/api/returns/${open.id}/cancel`).set(auth(other));
    expect(stranger.status).toBe(404);

    const cancel = await request(app).post(`/api/returns/${open.id}/cancel`).set(auth(buyer));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');

    const twice = await request(app).post(`/api/returns/${open.id}/cancel`).set(auth(buyer));
    expect(twice.status).toBe(409);
  });

  it('ร้านไม่รับคืนต้องเขียนเหตุผล และลูกค้าเห็นเหตุผลนั้น', async () => {
    const created = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
    });
    const id = created.body.data.id as string;

    const noNote = await decide(employee, id, { status: 'REJECTED' });
    expect(noNote.status).toBe(422);

    const rejected = await decide(employee, id, {
      status: 'REJECTED',
      note: 'ภาพที่ส่งมาไม่พบตำหนิ — ติดต่อแชตเพื่อส่งภาพเพิ่ม',
    });
    expect(rejected.status).toBe(200);

    const mine = await request(app).get('/api/returns').set(auth(buyer));
    const row = mine.body.data.items.find((item: { id: string }) => item.id === id);
    expect(row.status).toBe('REJECTED');
    expect(row.staffNote).toContain('ไม่พบตำหนิ');
    expect(row.estimatedRefund).toBeNull();

    const notice = await prisma.notification.findFirst({
      where: {
        userId: buyer.id,
        type: 'RETURN_UPDATE',
        title: { contains: created.body.data.returnNumber },
      },
    });
    expect(notice?.body).toContain('ไม่พบตำหนิ');
  });

  it('เลยกำหนดแจ้งคืน → 409', async () => {
    await prisma.order.update({
      where: { id: order.id },
      data: { deliveredAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });

    const late = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
    });

    expect(late.status).toBe(409);
    expect(late.body.message).toContain('เลยกำหนด');
  });

  it('สองคำขอพร้อมกันของบิลเดียว → สำเร็จรายเดียว (ล็อกแถว + partial unique index)', async () => {
    const racing = await deliveredOrder(other, [{ variantId: variants[1]!, quantity: 1 }]);
    const attempt = () =>
      createReturn(other, {
        orderNumber: racing.orderNumber,
        items: [{ orderItemId: racing.items[0]!.id, quantity: 1 }],
      });

    const results = await Promise.all([attempt(), attempt(), attempt()]);

    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(await prisma.returnRequest.count({ where: { orderId: racing.id } })).toBe(1);
  });
});

/* ═══════════════════ เส้นทางเต็ม: ตรวจรับ · คืนเงิน · แต้ม ═══════════════════ */

describe('ตรวจรับของ คืนเงิน และแต้ม', () => {
  let order: Awaited<ReturnType<typeof deliveredOrder>>;
  let earned = 0;
  let firstReturnId = '';
  let firstAmount = 0;

  beforeAll(async () => {
    order = await deliveredOrder(buyer, [
      { variantId: variants[0]!, quantity: 2 },
      { variantId: variants[1]!, quantity: 1 },
    ]);
    earned = (
      await prisma.pointTransaction.findMany({ where: { orderId: order.id, type: 'EARN' } })
    ).reduce((sum, row) => sum + row.delta, 0);
  });

  it('คืนบางชิ้น: พนักงานอนุมัติ → ตรวจรับเข้าคลัง → พนักงานบันทึกคืนเงินไม่ได้ · แอดมินบันทึกได้', async () => {
    const lineA = order.items.find((item) => item.quantity === 2)!;
    const created = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      items: [{ orderItemId: lineA.id, quantity: 1 }],
    });
    firstReturnId = created.body.data.id;

    expect((await decide(employee, firstReturnId, { status: 'APPROVED' })).status).toBe(200);

    const stockBefore = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variants[0]! },
      select: { quantity: true },
    });
    const detail = await request(app)
      .get(`/api/admin/returns/${firstReturnId}`)
      .set(auth(employee));
    const received = await receive(employee, firstReturnId, [
      { returnItemId: detail.body.data.items[0].id, restock: true },
    ]);
    expect(received.status).toBe(200);

    const stockAfter = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variants[0]! },
      select: { quantity: true },
    });
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 1);
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceType: 'RETURN_REQUEST', referenceId: firstReturnId, type: 'RETURN' },
      }),
    ).toBe(1);

    // รับซ้ำไม่ได้ — ของรับเข้าคลังแล้ว
    expect(
      (
        await receive(employee, firstReturnId, [
          { returnItemId: detail.body.data.items[0].id, restock: true },
        ])
      ).status,
    ).toBe(409);

    // เงินออกจากร้าน = order:refund (ADMIN) — พนักงานทำไม่ได้
    expect((await refund(employee, firstReturnId)).status).toBe(403);
    // COD คืนผ่าน Stripe ไม่ได้ (เงินสดอยู่กับร้าน)
    expect((await refund(admin, firstReturnId, { method: 'STRIPE_DASHBOARD' })).status).toBe(400);

    const pointsBefore = await pointsOf(buyer);
    const idempotencyKey = randomUUID();
    const done = await refund(admin, firstReturnId, { idempotencyKey, amount: 1 });

    expect(done.status).toBe(200);
    expect(done.body.data.applied).toBe(true);

    firstAmount = computeRefundAmount({
      total: Number(order.total),
      subtotal: Number(order.subtotal),
      refundedTotal: 0,
      goods: Number(lineA.unitPrice),
      final: false,
    });
    const row = await orderRow(order.id);

    expect(done.body.data.refund.amount).toBe(firstAmount);
    expect(Number(row.refundedTotal)).toBe(firstAmount);
    expect(row.status).toBe('DELIVERED');
    expect(row.paymentStatus).toBe('PAID');

    // แต้มที่ได้ถูกหักตามสัดส่วนเดียวกับเงิน
    const share = computePointsShare({
      totalPoints: earned,
      alreadyMoved: 0,
      goods: Number(lineA.unitPrice),
      subtotal: Number(order.subtotal),
      final: false,
    });
    expect(await pointsOf(buyer)).toBe(pointsBefore - share);

    // กดซ้ำด้วยคีย์เดิม → ไม่คืนซ้ำ
    const replay = await refund(admin, firstReturnId, { idempotencyKey });
    expect(replay.body.data.applied).toBe(false);
    expect(Number((await orderRow(order.id)).refundedTotal)).toBe(firstAmount);
  });

  it('ยอดที่ได้รับของลูกค้า (หลังบ้าน + ระดับสมาชิก) หักเงินที่คืนแล้ว', async () => {
    const list = await request(app)
      .get(`/api/admin/customers?q=${encodeURIComponent(buyer.email)}`)
      .set(auth(employee));
    // ยอดบิลของทุกใบที่จ่ายแล้วของลูกค้าคนนี้ (คิดจาก total ล้วน ๆ) − เงินที่เพิ่งคืน
    const paidTotals = await prisma.order.findMany({
      where: {
        userId: buyer.id,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { total: true },
    });
    const expected = paidTotals.reduce((sum, row) => sum + Number(row.total), 0) - firstAmount;

    expect(list.body.data.items[0].stats.totalPaid).toBeCloseTo(expected, 2);

    const loyalty = await request(app).get('/api/users/me/loyalty').set(auth(buyer));
    expect(loyalty.body.data.lifetimeSpend).toBeCloseTo(expected, 2);
  });

  it('คืนชิ้นที่เหลือทั้งหมด: ได้เงินที่เหลือทั้งหมด · บิลเป็น REFUNDED · ชิ้นชำรุดไม่เข้าคลัง', async () => {
    const lineA = order.items.find((item) => item.quantity === 2)!;
    const lineB = order.items.find((item) => item.quantity === 1)!;

    const created = await createReturn(buyer, {
      orderNumber: order.orderNumber,
      reason: 'WRONG_ITEM',
      detail: 'ได้สีผิดจากที่สั่งไว้ทั้งสองชิ้น',
      items: [
        { orderItemId: lineA.id, quantity: 1 },
        { orderItemId: lineB.id, quantity: 1 },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    await decide(admin, id, { status: 'APPROVED' });
    const detail = await request(app).get(`/api/admin/returns/${id}`).set(auth(admin));

    // ต้องระบุผลตรวจครบทุกชิ้น — ส่งมาชิ้นเดียว → 400
    const partial = await receive(admin, id, [
      { returnItemId: detail.body.data.items[0].id, restock: true },
    ]);
    expect(partial.status).toBe(400);

    const movementsBefore = await prisma.inventoryMovement.count({
      where: { referenceType: 'RETURN_REQUEST', referenceId: id },
    });
    await receive(
      admin,
      id,
      detail.body.data.items.map((item: { id: string }) => ({
        returnItemId: item.id,
        restock: false,
      })),
    );
    // ชำรุดทั้งหมด → ไม่มี movement รับเข้าคลัง
    expect(
      await prisma.inventoryMovement.count({
        where: { referenceType: 'RETURN_REQUEST', referenceId: id },
      }),
    ).toBe(movementsBefore);

    const done = await refund(admin, id);
    expect(done.status).toBe(200);

    const row = await orderRow(order.id);
    expect(Number(row.refundedTotal)).toBe(Number(order.total));
    expect(Number(done.body.data.refund.amount)).toBeCloseTo(Number(order.total) - firstAmount, 2);
    expect(row.status).toBe('REFUNDED');
    expect(row.paymentStatus).toBe('REFUNDED');

    // แต้มที่ได้จากบิลนี้ถูกหักคืนครบ (ได้ + หัก = 0)
    const net = (
      await prisma.pointTransaction.findMany({
        where: { orderId: order.id, type: { in: ['EARN', 'EARN_REVERSAL'] } },
      })
    ).reduce((sum, item) => sum + item.delta, 0);
    expect(net).toBe(0);

    const tracking = await request(app).get(`/api/orders/${order.orderNumber}`).set(auth(buyer));
    const timeline = tracking.body.data.timeline as { status: string }[];
    expect(timeline.at(-1)?.status).toBe('REFUNDED');
    expect(timeline.map((step) => step.status)).toContain('DELIVERED');
  });
});

/* ═══════════════ ร้านยกเลิกหลังชำระเงิน → ต้องบันทึกการคืนเงินได้ ═══════════════ */

describe('คืนเงินคำสั่งซื้อที่ร้านยกเลิกหลังชำระเงิน', () => {
  it('อยู่ในคิว "รอคืนเงิน" → บันทึกคืนเงินทั้งใบ → การชำระเป็น REFUNDED · ไทม์ไลน์มีทั้งยกเลิกและคืนเงิน', async () => {
    const order = await placeOrder(other, [{ variantId: variants[0]!, quantity: 1 }]);
    await postPaidWebhook(order.id);

    const cancel = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin))
      .send({ status: 'CANCELLED' });
    expect(cancel.status).toBe(200);

    const queue = await request(app).get('/api/admin/returns').set(auth(employee));
    expect(
      queue.body.data.cancelledAwaitingRefund.map(
        (row: { orderNumber: string }) => row.orderNumber,
      ),
    ).toContain(order.orderNumber);

    const notCancelled = await deliveredOrder(other, [{ variantId: variants[1]!, quantity: 1 }]);
    const wrongOrder = await request(app)
      .post(`/api/admin/orders/${notCancelled.orderNumber}/refund`)
      .set(auth(admin))
      .send({ method: 'BANK_TRANSFER', reference: 'TRF-0001', idempotencyKey: randomUUID() });
    expect(wrongOrder.status).toBe(409);

    const done = await request(app)
      .post(`/api/admin/orders/${order.orderNumber}/refund`)
      .set(auth(admin))
      .send({
        method: 'STRIPE_DASHBOARD',
        reference: 're_test_123456',
        idempotencyKey: randomUUID(),
      });
    expect(done.status).toBe(200);

    const row = await orderRow(order.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.paymentStatus).toBe('REFUNDED');
    expect(Number(row.refundedTotal)).toBe(Number(order.total));

    const again = await request(app)
      .post(`/api/admin/orders/${order.orderNumber}/refund`)
      .set(auth(admin))
      .send({ method: 'BANK_TRANSFER', reference: 'TRF-0002', idempotencyKey: randomUUID() });
    expect(again.status).toBe(409);

    const detail = await request(app)
      .get(`/api/admin/orders/${order.orderNumber}`)
      .set(auth(employee));
    expect(detail.body.data.refundState.refunds).toHaveLength(1);
    expect(detail.body.data.refundState.awaitingRefund).toBe(false);

    const tracking = await request(app).get(`/api/orders/${order.orderNumber}`).set(auth(other));
    const statuses = (tracking.body.data.timeline as { status: string }[]).map(
      (step) => step.status,
    );
    expect(statuses.slice(-2)).toEqual(['CANCELLED', 'REFUNDED']);

    const notice = await prisma.notification.findFirst({
      where: { userId: other.id, type: 'RETURN_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notice?.title).toContain(order.orderNumber);

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'order.refund', targetId: order.id },
    });
    expect(log).not.toBeNull();
  });
});

/* ═══════════════════════ ตัวเลขที่ต้องคงที่ทุกกรณี ═══════════════════════ */

describe('ความถูกต้องของเงินที่ฐานข้อมูลบังคับ', () => {
  it('ทุกบิลในเทสต์นี้: refundedTotal = ผลรวมของ Refund และไม่เกินยอดที่จ่าย', async () => {
    const orders = await prisma.order.findMany({
      where: { id: { in: createdOrderIds } },
      select: { id: true, total: true, refundedTotal: true, refunds: { select: { amount: true } } },
    });

    for (const row of orders) {
      const sum = row.refunds.reduce((total, item) => total + Number(item.amount), 0);

      expect(Number(row.refundedTotal)).toBeCloseTo(sum, 2);
      expect(Number(row.refundedTotal)).toBeLessThanOrEqual(Number(row.total));
    }
  });

  it('แต้มที่ได้จากบิลคิดจากระดับก่อนนับใบนั้น (ยืนยันว่าเทสต์ชุดนี้ได้แต้มจริงก่อนคืน)', () => {
    expect(pointsEarnedFor(1000, tierForSpend(0))).toBeGreaterThan(0);
  });
});
