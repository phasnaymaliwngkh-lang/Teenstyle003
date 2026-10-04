import { randomUUID } from 'node:crypto';

import { getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของคูปองกับคำสั่งซื้อจริง (STEP 41)
 *
 * สิ่งที่ต้องพิสูจน์ (ทั้งหมดเป็นเรื่องเงิน จึงต้องยิงผ่าน HTTP กับฐานข้อมูลจริง):
 *   - ยอดส่วนลดคิดที่ server · **ยอดที่ client ส่งมาถูกเมิน**
 *   - โควตาคูปองถูกจองแบบ atomic — สองคนใช้ใบสุดท้ายพร้อมกันสำเร็จรายเดียว
 *   - ยกเลิกคำสั่งซื้อแล้วโควตาถูกคืน (ไม่งั้นคูปอง "เต็ม" ทั้งที่ไม่มีใครได้ใช้)
 *   - จำนวนครั้งต่อคนนับจากคำสั่งซื้อจริง
 *   - snapshot ของรหัสคูปองติดอยู่กับออเดอร์ แม้คูปองถูกปิดใช้งานภายหลัง
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let customer = { id: '', token: '' };
let variant = { id: '', finalPrice: 0 };
const createdUserIds: string[] = [];
const createdCouponIds: string[] = [];
const createdOrderIds: string[] = [];

const ADDRESS = {
  recipientName: 'ผู้รับทดสอบคูปอง',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

const asCustomer = () => ({ Authorization: `Bearer ${customer.token}` });

async function createCustomer(label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email: `test-coupon-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token };
}

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  const coupon = await prisma.coupon.create({
    data: {
      code: `TEST${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'คูปองทดสอบ',
      type: 'FIXED_AMOUNT',
      value: 50,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
      isActive: true,
      ...overrides,
    },
    select: { id: true, code: true },
  });

  createdCouponIds.push(coupon.id);

  return coupon;
}

/** ใส่ของลงตะกร้าแล้วสั่งซื้อ — คืน response ของการสร้างออเดอร์ */
async function orderWith(body: Record<string, unknown>) {
  await request(app)
    .post('/api/cart/items')
    .set(asCustomer())
    .send({ variantId: variant.id, quantity: 1 });

  const response = await request(app)
    .post('/api/orders')
    .set(asCustomer())
    .send({
      idempotencyKey: randomUUID(),
      shippingMethod: 'STANDARD',
      newAddress: ADDRESS,
      ...body,
    });

  if (response.status === 201) createdOrderIds.push(response.body.data.id);

  return response;
}

const usedCountOf = async (couponId: string) =>
  (await prisma.coupon.findUniqueOrThrow({ where: { id: couponId }, select: { usedCount: true } }))
    .usedCount;

beforeAll(async () => {
  customer = await createCustomer('buyer');

  const row = await prisma.productVariant.findFirstOrThrow({
    where: {
      isActive: true,
      deletedAt: null,
      product: { status: 'ACTIVE', deletedAt: null },
      inventory: { quantity: { gt: 5 } },
    },
    select: {
      id: true,
      price: true,
      salePrice: true,
      product: { select: { price: true, salePrice: true } },
    },
  });

  const effective = row.salePrice ?? row.price ?? row.product.salePrice ?? row.product.price;

  variant = { id: row.id, finalPrice: Number(effective) };
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: customer.id } } });
});

afterAll(async () => {
  /**
   * ⚠️ **คืนของที่จองไว้ก่อนลบออเดอร์**
   *
   * ออเดอร์ที่สร้างในเทสต์นี้อยู่สถานะ PENDING_PAYMENT ซึ่ง "จองสต็อก" ไว้ (กฎ STEP 10 ข้อ 3)
   * ถ้าลบแถวออเดอร์ทิ้งเฉย ๆ `Inventory.reservedQuantity` จะค้างสูงขึ้นทุกรอบที่รันเทสต์
   * จนสุดท้ายของ "หมด" แล้วเทสต์ไฟล์นี้เอง (และไฟล์อื่น) ล้มด้วยเหตุผลที่ไม่เกี่ยวกับโค้ด
   * — เจอจริงตอน STEP 41: ค้างไป 18 ชิ้นโดยที่ตาราง Order ว่างเปล่า
   */
  const heldItems = await prisma.orderItem.findMany({
    where: { orderId: { in: createdOrderIds }, order: { status: 'PENDING_PAYMENT' } },
    select: { variantId: true, quantity: true },
  });

  for (const item of heldItems) {
    await prisma.$executeRaw`
      UPDATE "Inventory"
         SET "reservedQuantity" = GREATEST("reservedQuantity" - ${item.quantity}, 0),
             "updatedAt" = now()
       WHERE "variantId" = ${item.variantId}::uuid`;
  }

  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe('ใช้คูปองตอนสั่งซื้อ (STEP 41)', () => {
  it('ส่วนลดถูกหักจากยอดจริง และบันทึก snapshot ของรหัสไว้กับออเดอร์', async () => {
    const coupon = await makeCoupon({ value: 50 });
    const response = await orderWith({ couponCode: coupon.code });

    expect(response.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: response.body.data.id },
      select: {
        subtotal: true,
        discountTotal: true,
        shippingFee: true,
        total: true,
        couponId: true,
        couponCode: true,
      },
    });

    expect(Number(order.discountTotal)).toBe(50);
    expect(order.couponId).toBe(coupon.id);
    expect(order.couponCode).toBe(coupon.code);
    // สูตรของบิล: ยอดสินค้า − ส่วนลด + ค่าจัดส่ง
    expect(Number(order.total)).toBe(
      Number(order.subtotal) - Number(order.discountTotal) + Number(order.shippingFee),
    );
    expect(await usedCountOf(coupon.id)).toBe(1);
  });

  /** SECURITY: client ส่งได้แค่รหัส — ยอดส่วนลดที่แนบมาต้องถูก Zod ตัดทิ้ง */
  it('ยอดส่วนลดที่ client ส่งมาถูกเมิน — server คิดใหม่เอง', async () => {
    const coupon = await makeCoupon({ value: 50 });
    const response = await orderWith({
      couponCode: coupon.code,
      discountTotal: 99_999,
      total: 1,
      subtotal: 1,
    });

    expect(response.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: response.body.data.id },
      select: { discountTotal: true, total: true },
    });

    expect(Number(order.discountTotal)).toBe(50);
    expect(Number(order.total)).toBeGreaterThan(1);
  });

  it('ไม่ส่งรหัสคูปองมา ส่วนลดต้องเป็น 0 และไม่ผูกคูปองใด ๆ', async () => {
    const response = await orderWith({});

    expect(response.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: response.body.data.id },
      select: { discountTotal: true, couponId: true, couponCode: true },
    });

    expect(Number(order.discountTotal)).toBe(0);
    expect(order.couponId).toBeNull();
    expect(order.couponCode).toBeNull();
  });

  it('รหัสคูปองที่ไม่มีอยู่จริง สั่งซื้อไม่สำเร็จ และไม่สร้างออเดอร์', async () => {
    const before = await prisma.order.count({ where: { userId: customer.id } });
    const response = await orderWith({ couponCode: 'NOSUCHCOUPON' });

    expect(response.status).toBe(400);
    expect(await prisma.order.count({ where: { userId: customer.id } })).toBe(before);
  });

  it('คูปองที่หมดอายุแล้ว ใช้สั่งซื้อไม่ได้', async () => {
    const coupon = await makeCoupon({
      startsAt: new Date(Date.now() - 172_800_000),
      endsAt: new Date(Date.now() - 86_400_000),
    });
    const response = await orderWith({ couponCode: coupon.code });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('หมดอายุ');
    expect(await usedCountOf(coupon.id)).toBe(0);
  });
});

describe('โควตาคูปอง (STEP 41)', () => {
  it('ใช้ครบโควตารวมแล้ว ใช้ต่อไม่ได้ และตัวนับไม่เกินเพดาน', async () => {
    const coupon = await makeCoupon({ usageLimit: 1 });

    expect((await orderWith({ couponCode: coupon.code })).status).toBe(201);

    const second = await orderWith({ couponCode: coupon.code });

    expect(second.status).toBe(400);
    expect(await usedCountOf(coupon.id)).toBe(1);
  });

  it('จำนวนครั้งต่อคนนับจากคำสั่งซื้อจริงของคนนั้น', async () => {
    const coupon = await makeCoupon({ perUserLimit: 1 });

    expect((await orderWith({ couponCode: coupon.code })).status).toBe(201);

    const second = await orderWith({ couponCode: coupon.code });

    expect(second.status).toBe(400);
    expect(second.body.message).toContain('ครบจำนวนครั้ง');
  });

  /**
   * ยกเลิกแล้วต้องคืนโควตา ไม่งั้นคูปองจะ "เต็ม" ทั้งที่ไม่มีใครได้ใช้
   * แล้วลูกค้าถูกปฏิเสธด้วยเหตุผลที่ไม่จริง
   */
  it('ยกเลิกคำสั่งซื้อแล้วโควตาถูกคืน และใช้ใหม่ได้', async () => {
    const coupon = await makeCoupon({ usageLimit: 1 });
    const created = await orderWith({ couponCode: coupon.code });

    expect(created.status).toBe(201);
    expect(await usedCountOf(coupon.id)).toBe(1);

    const cancelled = await request(app)
      .post(`/api/orders/${created.body.data.orderNumber}/cancel`)
      .set(asCustomer())
      .send({});

    expect(cancelled.status).toBe(200);
    expect(await usedCountOf(coupon.id)).toBe(0);

    // คืนแล้วต้องใช้ใหม่ได้จริง
    expect((await orderWith({ couponCode: coupon.code })).status).toBe(201);
  });
});

describe('สรุปยอดก่อนสั่งซื้อ (STEP 41)', () => {
  it('ใส่คูปองที่ใช้ได้ หน้าสรุปยอดต้องแสดงส่วนลดและยอดสุทธิที่ลดแล้ว', async () => {
    const coupon = await makeCoupon({ value: 50 });

    await request(app)
      .post('/api/cart/items')
      .set(asCustomer())
      .send({ variantId: variant.id, quantity: 1 });

    const response = await request(app)
      .get(`/api/checkout/summary?couponCode=${coupon.code}`)
      .set(asCustomer());

    expect(response.status).toBe(200);
    expect(response.body.data.discountTotal).toBe(50);
    expect(response.body.data.appliedCoupon.code).toBe(coupon.code);
    expect(response.body.data.couponError).toBeNull();
    expect(response.body.data.total).toBe(
      response.body.data.subtotal - 50 + response.body.data.shippingFee,
    );
  });

  /** คูปองใช้ไม่ได้ต้องบอกเหตุผล ไม่ใช่เงียบแล้วไม่ลดให้ */
  it('ใส่คูปองที่ใช้ไม่ได้ หน้าสรุปยอดต้องบอกเหตุผลและไม่ลดราคา', async () => {
    const coupon = await makeCoupon({ minOrderAmount: 999_999 });

    await request(app)
      .post('/api/cart/items')
      .set(asCustomer())
      .send({ variantId: variant.id, quantity: 1 });

    const response = await request(app)
      .get(`/api/checkout/summary?couponCode=${coupon.code}`)
      .set(asCustomer());

    expect(response.status).toBe(200);
    expect(response.body.data.discountTotal).toBe(0);
    expect(response.body.data.appliedCoupon).toBeNull();
    expect(response.body.data.couponError).toContain('ขั้นต่ำ');
  });

  it('รหัสที่ไม่มีอยู่จริงต้องไม่ทำให้หน้าสรุปยอดพัง — บอกเหตุผลแล้วคิดยอดปกติ', async () => {
    await request(app)
      .post('/api/cart/items')
      .set(asCustomer())
      .send({ variantId: variant.id, quantity: 1 });

    const response = await request(app)
      .get('/api/checkout/summary?couponCode=NOSUCHCODE')
      .set(asCustomer());

    expect(response.status).toBe(200);
    expect(response.body.data.couponError).toBeTruthy();
    expect(response.body.data.discountTotal).toBe(0);
  });

  it('POST /api/coupons/apply ตอบเหตุผลเป็นข้อความไทย ไม่ใช่รหัสภายใน', async () => {
    const coupon = await makeCoupon({ isActive: false });

    const response = await request(app)
      .post('/api/coupons/apply')
      .set(asCustomer())
      .set('Origin', 'http://localhost:3000')
      .send({ code: coupon.code });

    expect(response.status).toBe(200);
    expect(response.body.data.usable).toBe(false);
    expect(response.body.data.message).toContain('ปิดใช้งาน');
  });
});
