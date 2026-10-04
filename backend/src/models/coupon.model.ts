import { toNumber } from './pricing.ts';

/**
 * กฎการคิดส่วนลดจากคูปอง — **แหล่งความจริงเดียว** (STEP 41)
 *
 * ทุกที่ที่ต้องรู้ว่า "คูปองนี้ลดเท่าไร" ต้องเรียก `evaluateCoupon()` จากไฟล์นี้:
 * หน้าตะกร้า · สรุปยอด checkout · การสร้างคำสั่งซื้อจริง
 * ถ้าแยกกันคิด วันหนึ่งยอดที่โชว์กับยอดที่เก็บเงินจะไม่ตรงกัน แล้วไม่มีใครรู้ว่าอันไหนถูก
 * (ปัญหาเดียวกับที่เจอตอน STEP 9: กฎราคาเคยเขียนซ้ำ 4 ที่ → รวมมาไว้ที่ `pricing.ts`)
 *
 * ⚠️ client ส่งได้แค่ **รหัสคูปอง** ตัวเลขทุกตัวคิดที่นี่จากข้อมูลในฐานข้อมูลเท่านั้น
 *    (SECURITY REQUIREMENT: ห้ามเชื่อราคา/ส่วนลดจาก client)
 */

export type DiscountTypeCode = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';

/** เหตุผลที่ใช้คูปองไม่ได้ — ต้องบอกผู้ใช้ตรง ๆ ว่าทำไม ไม่ใช่ปฏิเสธเฉย ๆ */
export type CouponRejection =
  | 'NOT_FOUND'
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'PER_USER_LIMIT_REACHED'
  | 'MIN_ORDER_NOT_MET'
  | 'NO_ELIGIBLE_ITEMS'
  | 'NO_DISCOUNT';

export const COUPON_REJECTION_MESSAGE: Record<CouponRejection, string> = {
  NOT_FOUND: 'ไม่พบคูปองนี้ — ตรวจตัวสะกดอีกครั้ง',
  INACTIVE: 'คูปองนี้ถูกปิดใช้งานแล้ว',
  NOT_STARTED: 'คูปองนี้ยังไม่เริ่มใช้',
  EXPIRED: 'คูปองนี้หมดอายุแล้ว',
  USAGE_LIMIT_REACHED: 'คูปองนี้ถูกใช้ครบจำนวนที่กำหนดแล้ว',
  PER_USER_LIMIT_REACHED: 'คุณใช้คูปองนี้ครบจำนวนครั้งที่กำหนดแล้ว',
  MIN_ORDER_NOT_MET: 'ยอดสินค้ายังไม่ถึงขั้นต่ำของคูปองนี้',
  NO_ELIGIBLE_ITEMS: 'ไม่มีสินค้าในตะกร้าที่ใช้คูปองนี้ได้',
  NO_DISCOUNT: 'คูปองนี้ใช้กับตะกร้านี้แล้วไม่ได้ส่วนลด',
};

/** แถวคูปองเท่าที่การคิดส่วนลดต้องใช้ */
export interface CouponRow {
  id: string;
  code: string;
  name: string;
  type: DiscountTypeCode;
  value: unknown;
  minOrderAmount: unknown;
  maxDiscountAmount: unknown;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  products: { id: string }[];
  categories: { id: string }[];
}

/** รายการในตะกร้าเท่าที่การคิดส่วนลดต้องใช้ */
export interface CouponCartLine {
  productId: string;
  categoryId: string | null;
  lineTotal: number;
}

export interface CouponEvaluation {
  ok: boolean;
  rejection: CouponRejection | null;
  message: string | null;
  /** ส่วนลดที่หักจากยอดสินค้า (บาท) */
  discountTotal: number;
  /** ค่าจัดส่งที่ถูกยกเว้น (บาท) — FREE_SHIPPING เท่านั้น */
  shippingDiscount: number;
  /** ยอดสินค้าที่คูปองนี้ใช้ได้จริง (ตามขอบเขตสินค้า/หมวด) */
  eligibleSubtotal: number;
}

const reject = (rejection: CouponRejection): CouponEvaluation => ({
  ok: false,
  rejection,
  message: COUPON_REJECTION_MESSAGE[rejection],
  discountTotal: 0,
  shippingDiscount: 0,
  eligibleSubtotal: 0,
});

/** ปัดเป็นสตางค์ — เงินต้องไม่มีเศษทศนิยมลอย ๆ จาก floating point */
const toSatang = (value: number) => Math.round(value * 100) / 100;

/**
 * คูปองนี้ใช้กับรายการนี้ได้ไหม
 *
 * ไม่ระบุสินค้าและหมวดเลย = ใช้ได้กับทุกอย่าง · ระบุอย่างใดอย่างหนึ่ง = ต้องเข้าเกณฑ์นั้น
 */
function lineIsEligible(coupon: CouponRow, line: CouponCartLine): boolean {
  const hasScope = coupon.products.length > 0 || coupon.categories.length > 0;

  if (!hasScope) return true;

  if (coupon.products.some((product) => product.id === line.productId)) return true;
  if (line.categoryId !== null) {
    return coupon.categories.some((category) => category.id === line.categoryId);
  }

  return false;
}

/**
 * ตรวจและคิดส่วนลด
 *
 * @param now เวลาที่ใช้ตัดสินช่วงใช้งาน — รับเข้ามาเพื่อให้เทสต์กำหนดเวลาได้
 * @param userUsedCount จำนวนครั้งที่ผู้ใช้คนนี้ใช้คูปองนี้ไปแล้ว
 * @param shippingFee ค่าจัดส่งที่จะถูกยกเว้นถ้าเป็นคูปองส่งฟรี
 */
export function evaluateCoupon(params: {
  coupon: CouponRow;
  lines: CouponCartLine[];
  shippingFee: number;
  userUsedCount: number;
  now: Date;
}): CouponEvaluation {
  const { coupon, lines, shippingFee, userUsedCount, now } = params;

  if (!coupon.isActive) return reject('INACTIVE');
  if (now < coupon.startsAt) return reject('NOT_STARTED');
  if (now > coupon.endsAt) return reject('EXPIRED');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return reject('USAGE_LIMIT_REACHED');
  }
  if (coupon.perUserLimit !== null && userUsedCount >= coupon.perUserLimit) {
    return reject('PER_USER_LIMIT_REACHED');
  }

  /**
   * ยอดขั้นต่ำเทียบกับ **ยอดสินค้าทั้งตะกร้า** ไม่ใช่เฉพาะส่วนที่เข้าเกณฑ์
   * เพราะ "ซื้อครบ 1,000 ลด 100" หมายถึงยอดบิล ไม่ใช่ยอดของหมวดที่คูปองคุม
   */
  const cartSubtotal = toSatang(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const minOrderAmount = coupon.minOrderAmount === null ? null : toNumber(coupon.minOrderAmount);

  if (minOrderAmount !== null && cartSubtotal < minOrderAmount) return reject('MIN_ORDER_NOT_MET');

  const eligibleSubtotal = toSatang(
    lines
      .filter((line) => lineIsEligible(coupon, line))
      .reduce((sum, line) => sum + line.lineTotal, 0),
  );

  if (eligibleSubtotal <= 0 && coupon.type !== 'FREE_SHIPPING') {
    return reject('NO_ELIGIBLE_ITEMS');
  }

  const value = toNumber(coupon.value);
  const maxDiscount = coupon.maxDiscountAmount === null ? null : toNumber(coupon.maxDiscountAmount);

  let discountTotal = 0;
  let shippingDiscount = 0;

  if (coupon.type === 'FREE_SHIPPING') {
    shippingDiscount = toSatang(Math.max(0, shippingFee));
  } else if (coupon.type === 'PERCENTAGE') {
    discountTotal = toSatang((eligibleSubtotal * value) / 100);
  } else {
    discountTotal = toSatang(value);
  }

  if (maxDiscount !== null) {
    discountTotal = Math.min(discountTotal, maxDiscount);
    if (coupon.type === 'FREE_SHIPPING') shippingDiscount = Math.min(shippingDiscount, maxDiscount);
  }

  /**
   * ⚠️ ส่วนลดห้ามเกินยอดที่เข้าเกณฑ์ — ไม่งั้นยอดสุทธิติดลบ (ร้านต้องจ่ายเงินให้ลูกค้า)
   *    กฎเดียวกับสต็อกที่ห้ามติดลบของ STEP 6
   */
  discountTotal = Math.min(discountTotal, eligibleSubtotal);

  if (discountTotal <= 0 && shippingDiscount <= 0) return reject('NO_DISCOUNT');

  return {
    ok: true,
    rejection: null,
    message: null,
    discountTotal,
    shippingDiscount,
    eligibleSubtotal,
  };
}

/** DTO ที่ส่งให้หน้าเว็บ — ไม่มีข้อมูลภายในอย่าง usedCount ของคูปองหลุดไป */
export interface AppliedCouponDto {
  code: string;
  name: string;
  type: DiscountTypeCode;
  discountTotal: number;
  shippingDiscount: number;
}

export function toAppliedCoupon(
  coupon: Pick<CouponRow, 'code' | 'name' | 'type'>,
  evaluation: CouponEvaluation,
): AppliedCouponDto {
  return {
    code: coupon.code,
    name: coupon.name,
    type: coupon.type,
    discountTotal: evaluation.discountTotal,
    shippingDiscount: evaluation.shippingDiscount,
  };
}
