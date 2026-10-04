import { describe, expect, it } from 'vitest';

import { evaluateCoupon, type CouponCartLine, type CouponRow } from '../src/models/coupon.model.ts';
import { createCouponSchema, updateCouponSchema } from '../src/validators/coupon.validator.ts';

/**
 * กฎการคิดส่วนลด (STEP 41)
 *
 * ทดสอบที่ระดับฟังก์ชันล้วน เพราะ `evaluateCoupon()` คือ **แหล่งความจริงเดียว**
 * ของคำถามว่า "คูปองนี้ลดเท่าไร" ที่หน้าตะกร้า หน้าสรุปยอด และการสร้างออเดอร์ใช้ร่วมกัน
 * ถ้าตรรกะที่นี่ผิด ยอดที่โชว์กับยอดที่เก็บเงินจะผิดพร้อมกันทั้งระบบ
 */

const NOW = new Date('2026-10-05T10:00:00.000Z');

function coupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    id: 'coupon-1',
    code: 'SAVE100',
    name: 'ลด 100 บาท',
    type: 'FIXED_AMOUNT',
    value: 100,
    minOrderAmount: null,
    maxDiscountAmount: null,
    usageLimit: null,
    usedCount: 0,
    perUserLimit: null,
    startsAt: new Date('2026-10-01T00:00:00.000Z'),
    endsAt: new Date('2026-10-31T23:59:59.000Z'),
    isActive: true,
    products: [],
    categories: [],
    ...overrides,
  };
}

const line = (overrides: Partial<CouponCartLine> = {}): CouponCartLine => ({
  productId: 'product-1',
  categoryId: 'category-1',
  lineTotal: 1000,
  ...overrides,
});

const evaluate = (
  couponOverrides: Partial<CouponRow> = {},
  options: {
    lines?: CouponCartLine[];
    shippingFee?: number;
    userUsedCount?: number;
    now?: Date;
  } = {},
) =>
  evaluateCoupon({
    coupon: coupon(couponOverrides),
    lines: options.lines ?? [line()],
    shippingFee: options.shippingFee ?? 50,
    userUsedCount: options.userUsedCount ?? 0,
    now: options.now ?? NOW,
  });

describe('คิดส่วนลดตามชนิดของคูปอง (STEP 41)', () => {
  it('FIXED_AMOUNT ลดเป็นจำนวนบาทตามที่ตั้งไว้', () => {
    const result = evaluate({ type: 'FIXED_AMOUNT', value: 100 });

    expect(result.ok).toBe(true);
    expect(result.discountTotal).toBe(100);
    expect(result.shippingDiscount).toBe(0);
  });

  it('PERCENTAGE ลดตามสัดส่วนของยอดที่เข้าเกณฑ์', () => {
    const result = evaluate({ type: 'PERCENTAGE', value: 15 });

    expect(result.discountTotal).toBe(150);
  });

  it('PERCENTAGE ถูกจำกัดด้วยส่วนลดสูงสุด', () => {
    const result = evaluate({ type: 'PERCENTAGE', value: 50, maxDiscountAmount: 200 });

    expect(result.discountTotal).toBe(200);
  });

  it('FREE_SHIPPING ยกเว้นค่าจัดส่ง ไม่ได้ลดยอดสินค้า', () => {
    const result = evaluate({ type: 'FREE_SHIPPING', value: 0 }, { shippingFee: 70 });

    expect(result.ok).toBe(true);
    expect(result.discountTotal).toBe(0);
    expect(result.shippingDiscount).toBe(70);
  });

  it('FREE_SHIPPING ตอนส่งฟรีอยู่แล้ว ต้องบอกว่าใช้ไม่ได้ ไม่ใช่ลด 0 แล้วเงียบ', () => {
    const result = evaluate({ type: 'FREE_SHIPPING', value: 0 }, { shippingFee: 0 });

    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('NO_DISCOUNT');
  });

  /**
   * ส่วนลดเกินยอดสินค้าแปลว่ายอดสุทธิติดลบ = ร้านต้องจ่ายเงินให้ลูกค้า
   * กฎเดียวกับสต็อกที่ห้ามติดลบของ STEP 6
   */
  it('ส่วนลดห้ามเกินยอดสินค้า — ยอดสุทธิติดลบไม่ได้', () => {
    const result = evaluate(
      { type: 'FIXED_AMOUNT', value: 5000 },
      { lines: [line({ lineTotal: 300 })] },
    );

    expect(result.discountTotal).toBe(300);
  });

  it('ยอดเงินปัดเป็นสตางค์ ไม่ทิ้งเศษจาก floating point', () => {
    const result = evaluate(
      { type: 'PERCENTAGE', value: 33 },
      { lines: [line({ lineTotal: 99.99 })] },
    );

    expect(result.discountTotal).toBe(Math.round(99.99 * 0.33 * 100) / 100);
    expect(Number.isInteger(result.discountTotal * 100)).toBe(true);
  });
});

describe('เงื่อนไขที่ทำให้ใช้คูปองไม่ได้ (STEP 41)', () => {
  it('คูปองที่ปิดใช้งาน', () => {
    expect(evaluate({ isActive: false }).rejection).toBe('INACTIVE');
  });

  it('ยังไม่ถึงวันเริ่มใช้', () => {
    expect(evaluate({}, { now: new Date('2026-09-20T00:00:00.000Z') }).rejection).toBe(
      'NOT_STARTED',
    );
  });

  it('หมดอายุแล้ว', () => {
    expect(evaluate({}, { now: new Date('2026-11-05T00:00:00.000Z') }).rejection).toBe('EXPIRED');
  });

  it('ถูกใช้ครบโควตารวมแล้ว', () => {
    expect(evaluate({ usageLimit: 10, usedCount: 10 }).rejection).toBe('USAGE_LIMIT_REACHED');
  });

  it('คนนี้ใช้ครบจำนวนครั้งต่อคนแล้ว', () => {
    expect(evaluate({ perUserLimit: 1 }, { userUsedCount: 1 }).rejection).toBe(
      'PER_USER_LIMIT_REACHED',
    );
  });

  it('ยอดยังไม่ถึงขั้นต่ำ', () => {
    expect(
      evaluate({ minOrderAmount: 1500 }, { lines: [line({ lineTotal: 1000 })] }).rejection,
    ).toBe('MIN_ORDER_NOT_MET');
  });

  /** ยอดขั้นต่ำเทียบกับยอดบิลทั้งใบ ไม่ใช่เฉพาะส่วนที่คูปองคุม */
  it('ยอดขั้นต่ำนับจากยอดสินค้าทั้งตะกร้า ไม่ใช่แค่ส่วนที่เข้าเกณฑ์', () => {
    const result = evaluate(
      { minOrderAmount: 1500, products: [{ id: 'product-1' }], type: 'FIXED_AMOUNT', value: 100 },
      {
        lines: [
          line({ productId: 'product-1', lineTotal: 800 }),
          line({ productId: 'product-2', lineTotal: 800 }),
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(result.eligibleSubtotal).toBe(800);
    expect(result.discountTotal).toBe(100);
  });

  it('ทุกเหตุผลที่ปฏิเสธต้องมีข้อความไทยบอกผู้ใช้', () => {
    for (const result of [
      evaluate({ isActive: false }),
      evaluate({ usageLimit: 1, usedCount: 1 }),
      evaluate({ minOrderAmount: 99_999 }),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.message).toBeTruthy();
      expect(result.message).not.toMatch(/[A-Z_]{5,}/);
    }
  });
});

describe('ขอบเขตสินค้า/หมวดของคูปอง (STEP 41)', () => {
  it('ไม่ระบุขอบเขต = ใช้ได้กับทุกอย่าง', () => {
    const result = evaluate(
      { type: 'PERCENTAGE', value: 10 },
      { lines: [line({ lineTotal: 500 })] },
    );

    expect(result.eligibleSubtotal).toBe(500);
  });

  it('ระบุสินค้า = คิดเฉพาะยอดของสินค้านั้น', () => {
    const result = evaluate(
      { type: 'PERCENTAGE', value: 10, products: [{ id: 'product-1' }] },
      {
        lines: [
          line({ productId: 'product-1', lineTotal: 500 }),
          line({ productId: 'product-9', lineTotal: 500 }),
        ],
      },
    );

    expect(result.eligibleSubtotal).toBe(500);
    expect(result.discountTotal).toBe(50);
  });

  it('ระบุหมวด = คิดเฉพาะยอดของหมวดนั้น', () => {
    const result = evaluate(
      { type: 'PERCENTAGE', value: 20, categories: [{ id: 'category-7' }] },
      {
        lines: [
          line({ categoryId: 'category-7', lineTotal: 300 }),
          line({ categoryId: 'category-1', lineTotal: 700 }),
        ],
      },
    );

    expect(result.eligibleSubtotal).toBe(300);
    expect(result.discountTotal).toBe(60);
  });

  it('ไม่มีสินค้าที่เข้าเกณฑ์ ต้องบอกเหตุผล ไม่ใช่ลด 0 เงียบ ๆ', () => {
    const result = evaluate(
      { products: [{ id: 'product-อื่น' }] },
      { lines: [line({ productId: 'product-1' })] },
    );

    expect(result.rejection).toBe('NO_ELIGIBLE_ITEMS');
  });
});

describe('ด่าน Zod ของคูปอง (STEP 41)', () => {
  const base = {
    code: 'save100',
    name: 'ลด 100',
    type: 'FIXED_AMOUNT' as const,
    value: 100,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
  };

  it('รหัสคูปองถูกทำเป็นตัวพิมพ์ใหญ่ให้เสมอ — คนพิมพ์ตัวเล็กก็ต้องใช้ได้', () => {
    expect(createCouponSchema.parse(base).code).toBe('SAVE100');
  });

  it('เปอร์เซ็นต์เกิน 100 สร้างไม่ได้', () => {
    const result = createCouponSchema.safeParse({ ...base, type: 'PERCENTAGE', value: 120 });

    expect(result.success).toBe(false);
  });

  it('มูลค่าส่วนลด 0 สร้างไม่ได้ — คูปองที่ใช้แล้วไม่ได้อะไรคือการหลอกลูกค้า', () => {
    expect(createCouponSchema.safeParse({ ...base, value: 0 }).success).toBe(false);
  });

  it('คูปองส่งฟรีไม่ต้องมีมูลค่า', () => {
    const result = createCouponSchema.safeParse({ ...base, type: 'FREE_SHIPPING', value: 0 });

    expect(result.success).toBe(true);
  });

  it('วันหมดอายุต้องหลังวันเริ่มใช้', () => {
    const result = createCouponSchema.safeParse({
      ...base,
      startsAt: '2026-10-31T00:00:00.000Z',
      endsAt: '2026-10-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  /**
   * กฎ STEP 14: schema ที่เอาไป `.partial()` ห้ามมี `.default()`
   * ไม่งั้น PATCH แค่ชื่อจะเผลอรีเซ็ตฟิลด์อื่นเงียบ ๆ
   */
  it('PATCH ชื่อเดียว ต้องไม่มีฟิลด์อื่นถูกเติมค่า default มาด้วย', () => {
    const parsed = updateCouponSchema.parse({ name: 'ชื่อใหม่' });

    expect(Object.keys(parsed)).toEqual(['name']);
  });

  it('PATCH ที่ไม่มีข้อมูลเลยต้องไม่ผ่าน', () => {
    expect(updateCouponSchema.safeParse({}).success).toBe(false);
  });

  it('ฟิลด์ที่ client ไม่ควรตั้งเองถูกตัดทิ้ง (usedCount, id)', () => {
    const parsed = createCouponSchema.parse({ ...base, usedCount: 999, id: 'ปลอม' });

    expect(parsed).not.toHaveProperty('usedCount');
    expect(parsed).not.toHaveProperty('id');
  });
});
