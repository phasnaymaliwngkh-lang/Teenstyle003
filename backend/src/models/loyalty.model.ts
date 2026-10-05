import {
  EARN_BAHT_PER_POINT,
  LOYALTY_TIERS,
  REDEEM_MAX_PERCENT_OF_SUBTOTAL,
  REDEEM_MINIMUM_POINTS,
  REDEEM_POINTS_PER_BAHT,
  REDEEM_STEP_POINTS,
  type LoyaltyTierCode,
  type LoyaltyTierRule,
} from '../config/loyalty.ts';

/**
 * กฎของแต้มสะสม — **แหล่งความจริงเดียว** (STEP 42)
 *
 * ทุกที่ที่ต้องรู้ว่า "ได้กี่แต้ม" "ใช้ได้กี่แต้ม" "อยู่ระดับไหน" เรียกฟังก์ชันจากไฟล์นี้:
 * การให้แต้มตอนร้านได้รับเงิน · สรุปยอด checkout · การสร้างคำสั่งซื้อจริง · หน้าแต้มของลูกค้า ·
 * หน้าลูกค้าในหลังบ้าน — ถ้าแยกกันคิด ตัวเลขที่บอกลูกค้ากับที่คิดจริงจะไม่ตรงกัน
 * (บทเรียนเดียวกับ `pricing.ts` ของ STEP 9 และ `coupon.model.ts` ของ STEP 41)
 *
 * ทุกฟังก์ชันเป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล — เทสต์ป้อนค่าเข้าได้ตรง ๆ
 *
 * ⚠️ คำนวณเงินเป็น **สตางค์ (จำนวนเต็ม)** ก่อนปัดแต้มเสมอ
 *    `Math.floor(1000.1 / 10)` กับทศนิยมลอยของ JS ให้ผลถูกบ้างผิดบ้างตามตัวเลข
 *    ลูกค้าที่ควรได้ 100 แต้มแล้วได้ 99 คือการโกงลูกค้าโดยไม่มีใครตั้งใจ
 */

const toSatang = (baht: number): number => Math.round(baht * 100);

/* ─────────────────────────────── ระดับสมาชิก ─────────────────────────────── */

/**
 * ระดับจากยอดที่จ่ายจริงสะสม
 *
 * ⚠️ ระดับไม่ถูกเก็บเป็นคอลัมน์ — คำนวณสดทุกครั้งจากยอดในตาราง Order
 *    (เดิม `User.loyaltyTier` เป็นคอลัมน์ที่ไม่มีใครเขียน ทุกคนเป็น MEMBER ตลอดกาล)
 */
export function tierForSpend(spend: number): LoyaltyTierRule {
  let current = LOYALTY_TIERS[0]!;

  for (const tier of LOYALTY_TIERS) {
    if (toSatang(spend) >= toSatang(tier.minSpend)) current = tier;
  }

  return current;
}

export function tierByCode(code: LoyaltyTierCode): LoyaltyTierRule {
  return LOYALTY_TIERS.find((tier) => tier.code === code) ?? LOYALTY_TIERS[0]!;
}

/** ระดับถัดไปและยอดที่ต้องจ่ายเพิ่ม — `null` = อยู่ระดับสูงสุดแล้ว */
export function nextTierFor(spend: number): { tier: LoyaltyTierRule; remaining: number } | null {
  const next = LOYALTY_TIERS.find((tier) => toSatang(tier.minSpend) > toSatang(spend));

  if (next === undefined) return null;

  return { tier: next, remaining: (toSatang(next.minSpend) - toSatang(spend)) / 100 };
}

/** ระดับ A สูงกว่าระดับ B ไหม — ใช้ตัดสินว่า "ขึ้นระดับ" ควรแจ้งลูกค้าหรือเปล่า */
export function isHigherTier(a: LoyaltyTierCode, b: LoyaltyTierCode): boolean {
  const rank = (code: LoyaltyTierCode) => LOYALTY_TIERS.findIndex((tier) => tier.code === code);

  return rank(a) > rank(b);
}

/* ────────────────────────────────── ได้แต้ม ────────────────────────────────── */

/**
 * แต้มที่ได้จากยอดที่จ่ายจริงของคำสั่งซื้อหนึ่งใบ
 *
 * ฐานคือ `Order.total` — **เงินที่ลูกค้าจ่ายจริงทั้งบิล** (หลังหักคูปองและแต้มที่ใช้แล้ว)
 * จึงไม่มีการได้แต้มจากส่วนที่จ่ายด้วยแต้ม และเป็นตัวเลขเดียวกับที่ลูกค้าเห็นบนใบสั่งซื้อ
 *
 * @param tier ระดับ **ก่อน** นับคำสั่งซื้อนี้ — ใบที่ทำให้ขึ้นระดับยังคิดตัวคูณของระดับเดิม
 */
export function pointsEarnedFor(paidAmount: number, tier: LoyaltyTierRule): number {
  const satang = toSatang(paidAmount);

  if (satang <= 0) return 0;

  // satang × (ตัวคูณร้อยละ) ÷ (บาทต่อแต้ม × 100 สตางค์ × 100 ร้อยละ) — จำนวนเต็มล้วน
  return Math.floor((satang * tier.earnMultiplierPercent) / (EARN_BAHT_PER_POINT * 100 * 100));
}

/* ────────────────────────────────── ใช้แต้ม ────────────────────────────────── */

export type RedemptionRejection =
  'NOT_A_STEP' | 'BELOW_MINIMUM' | 'NOT_ENOUGH_POINTS' | 'NOT_ALLOWED_FOR_ORDER' | 'OVER_LIMIT';

export interface RedemptionEvaluation {
  ok: boolean;
  rejection: RedemptionRejection | null;
  /** เหตุผลเป็นภาษาไทยที่บอกผู้ใช้ได้ตรง ๆ ว่าต้องแก้อะไร */
  message: string | null;
  /** แต้มที่ใช้จริง (0 = ไม่ได้ใช้) */
  points: number;
  /** มูลค่าส่วนลด (บาท) */
  discount: number;
  /** แต้มสูงสุดที่ใช้กับคำสั่งซื้อนี้ได้ — ส่งให้หน้าเว็บจำกัดช่องกรอกล่วงหน้า */
  maxPoints: number;
}

export interface RedemptionInput {
  /** แต้มที่ผู้ใช้ขอใช้ */
  requested: number;
  /** แต้มคงเหลือในบัญชี — อ่านจากฐานข้อมูล ไม่ใช่จาก client */
  balance: number;
  /** ยอดสินค้า (บาท) */
  subtotal: number;
  /**
   * ส่วนลดอื่นที่หักไปแล้วในบิลเดียวกัน (คูปอง รวมคูปองส่งฟรี)
   * เพราะ CHECK `Order_discount_not_over_subtotal` ของฐานข้อมูลบังคับให้
   * ส่วนลดทุกก้อนรวมกันไม่เกินยอดสินค้า
   */
  otherDiscount: number;
}

/**
 * แต้มสูงสุดที่ใช้ได้กับบิลนี้
 *
 * จำกัด 3 ชั้น: แต้มที่มี · `REDEEM_MAX_PERCENT_OF_SUBTOTAL` ของยอดสินค้า ·
 * ยอดสินค้าที่เหลือหลังหักคูปอง — แล้วปัดลงให้เป็นทวีคูณของ `REDEEM_STEP_POINTS`
 * ถ้าได้น้อยกว่าขั้นต่ำ = ใช้ไม่ได้เลย (0) ไม่ใช่ปัดขึ้นให้ถึงขั้นต่ำ
 */
export function maxRedeemablePoints(input: Omit<RedemptionInput, 'requested'>): number {
  const subtotal = toSatang(input.subtotal);
  const room = subtotal - toSatang(input.otherDiscount);
  const byPercent = Math.floor((subtotal * REDEEM_MAX_PERCENT_OF_SUBTOTAL) / 100);
  const capBaht = Math.floor(Math.max(0, Math.min(byPercent, room)) / 100);

  const capped = Math.min(Math.max(0, Math.floor(input.balance)), capBaht * REDEEM_POINTS_PER_BAHT);
  const stepped = Math.floor(capped / REDEEM_STEP_POINTS) * REDEEM_STEP_POINTS;

  return stepped >= REDEEM_MINIMUM_POINTS ? stepped : 0;
}

const pointsText = (points: number) => `${points.toLocaleString('th-TH')} แต้ม`;

/** มูลค่าเป็นบาทของจำนวนแต้ม (ใช้กับจำนวนที่เป็นทวีคูณของ step แล้วเท่านั้น) */
export const pointsToBaht = (points: number): number => points / REDEEM_POINTS_PER_BAHT;

/**
 * ตรวจและคิดส่วนลดจากแต้ม
 *
 * ⚠️ **ปฏิเสธพร้อมเหตุผล ไม่ปรับลดให้เงียบ ๆ** — ถ้าหน้าเว็บโชว์ว่าลด 50 บาท แต่ server
 *    ตัดเหลือ 40 บาทเอง ลูกค้าจะถูกเก็บเงินมากกว่าที่เห็น (กฎเดียวกับคูปองของ STEP 41 ข้อ 5)
 */
export function evaluateRedemption(input: RedemptionInput): RedemptionEvaluation {
  const maxPoints = maxRedeemablePoints(input);
  const requested = input.requested;

  const reject = (rejection: RedemptionRejection, message: string): RedemptionEvaluation => ({
    ok: false,
    rejection,
    message,
    points: 0,
    discount: 0,
    maxPoints,
  });

  if (requested === 0) {
    return { ok: true, rejection: null, message: null, points: 0, discount: 0, maxPoints };
  }

  if (!Number.isInteger(requested) || requested < 0 || requested % REDEEM_STEP_POINTS !== 0) {
    return reject(
      'NOT_A_STEP',
      `ใช้แต้มได้ทีละ ${pointsText(REDEEM_STEP_POINTS)} (= 1 บาท) — กรอกเป็นทวีคูณของ ${REDEEM_STEP_POINTS}`,
    );
  }

  if (requested < REDEEM_MINIMUM_POINTS) {
    return reject('BELOW_MINIMUM', `ใช้แต้มได้ขั้นต่ำ ${pointsText(REDEEM_MINIMUM_POINTS)}`);
  }

  if (requested > input.balance) {
    return reject(
      'NOT_ENOUGH_POINTS',
      `แต้มไม่พอ — คุณมี ${pointsText(Math.max(0, input.balance))}`,
    );
  }

  if (maxPoints === 0) {
    return reject(
      'NOT_ALLOWED_FOR_ORDER',
      `คำสั่งซื้อนี้ยังใช้แต้มไม่ได้ — แต้มจ่ายแทนเงินได้ไม่เกิน ${REDEEM_MAX_PERCENT_OF_SUBTOTAL}% ของยอดสินค้า และต้องใช้ขั้นต่ำ ${pointsText(REDEEM_MINIMUM_POINTS)}`,
    );
  }

  if (requested > maxPoints) {
    return reject(
      'OVER_LIMIT',
      `คำสั่งซื้อนี้ใช้แต้มได้สูงสุด ${pointsText(maxPoints)} (ไม่เกิน ${REDEEM_MAX_PERCENT_OF_SUBTOTAL}% ของยอดสินค้า หลังหักคูปอง)`,
    );
  }

  return {
    ok: true,
    rejection: null,
    message: null,
    points: requested,
    discount: pointsToBaht(requested),
    maxPoints,
  };
}

/* ─────────────────────────────────── DTO ─────────────────────────────────── */

export interface LoyaltyTierDto {
  code: LoyaltyTierCode;
  name: string;
  minSpend: number;
  earnMultiplierPercent: number;
}

/** กติกาที่หน้าเว็บใช้อธิบายให้ลูกค้าอ่าน — มาจาก config ตัวเดียวกับที่คิดจริง */
export interface LoyaltyRulesDto {
  earnBahtPerPoint: number;
  redeemPointsPerBaht: number;
  redeemStepPoints: number;
  redeemMinimumPoints: number;
  redeemMaxPercentOfSubtotal: number;
  tiers: LoyaltyTierDto[];
}

export const toTierDto = (tier: LoyaltyTierRule): LoyaltyTierDto => ({
  code: tier.code,
  name: tier.name,
  minSpend: tier.minSpend,
  earnMultiplierPercent: tier.earnMultiplierPercent,
});

export function loyaltyRules(): LoyaltyRulesDto {
  return {
    earnBahtPerPoint: EARN_BAHT_PER_POINT,
    redeemPointsPerBaht: REDEEM_POINTS_PER_BAHT,
    redeemStepPoints: REDEEM_STEP_POINTS,
    redeemMinimumPoints: REDEEM_MINIMUM_POINTS,
    redeemMaxPercentOfSubtotal: REDEEM_MAX_PERCENT_OF_SUBTOTAL,
    tiers: LOYALTY_TIERS.map(toTierDto),
  };
}

/** สถานะสมาชิกของผู้ใช้หนึ่งคน — ทุกตัวเลขมาจากฐานข้อมูลจริง */
export interface LoyaltyStandingDto {
  /** แต้มคงเหลือ (= ผลรวมของสมุดแต้ม) */
  points: number;
  /** ยอดที่จ่ายจริงสะสม — นับจากตาราง Order (เกณฑ์เดียวกับ "ยอดที่ได้รับ" ของหลังบ้าน) */
  lifetimeSpend: number;
  tier: LoyaltyTierDto;
  /** null = อยู่ระดับสูงสุดแล้ว */
  nextTier: (LoyaltyTierDto & { remaining: number }) | null;
}

export function toStanding(points: number, lifetimeSpend: number): LoyaltyStandingDto {
  const next = nextTierFor(lifetimeSpend);

  return {
    points,
    lifetimeSpend,
    tier: toTierDto(tierForSpend(lifetimeSpend)),
    nextTier: next === null ? null : { ...toTierDto(next.tier), remaining: next.remaining },
  };
}

export type PointTransactionTypeCode =
  'EARN' | 'REDEEM' | 'REDEEM_REFUND' | 'EARN_REVERSAL' | 'ADJUSTMENT';

export interface PointTransactionDto {
  id: string;
  type: PointTransactionTypeCode;
  /** บวก = ได้ · ลบ = ใช้/ถูกหัก */
  delta: number;
  balanceAfter: number;
  description: string;
  /** null = ไม่เกี่ยวกับคำสั่งซื้อ หรือแถวออเดอร์ไม่มีแล้ว (เลขยังอยู่ใน description) */
  orderNumber: string | null;
  createdAt: string;
}

export interface PointTransactionRow {
  id: string;
  type: string;
  delta: number;
  balanceAfter: number;
  description: string;
  createdAt: Date;
  order: { orderNumber: string } | null;
}

export function toPointTransactionDto(row: PointTransactionRow): PointTransactionDto {
  return {
    id: row.id,
    type: row.type as PointTransactionTypeCode,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    description: row.description,
    orderNumber: row.order?.orderNumber ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
