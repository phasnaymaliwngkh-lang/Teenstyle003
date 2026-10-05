/**
 * แต้มสะสมและระดับสมาชิก (STEP 42) — รูปเดียวกับ DTO ของ backend
 * (backend/src/models/loyalty.model.ts · loyalty.service.ts)
 *
 * ⚠️ หน้าเว็บ **ไม่คิดแต้มเอง** — ตัวเลขทุกตัว (แต้มที่ได้ · เพดานที่ใช้ได้ · ระดับ · กติกา)
 *    มาจาก server ซึ่งอ่านจาก config ตัวเดียวกับที่ใช้คิดจริง
 */

export const LOYALTY_TIER_CODES = ["MEMBER", "SILVER", "GOLD", "VIP"] as const;

export type LoyaltyTierCode = (typeof LOYALTY_TIER_CODES)[number];

export interface LoyaltyTier {
  code: LoyaltyTierCode;
  name: string;
  /** ยอดที่จ่ายจริงสะสม (บาท) ที่ทำให้ได้ระดับนี้ */
  minSpend: number;
  /** ตัวคูณแต้มเป็นร้อยละ (100 = ×1) */
  earnMultiplierPercent: number;
}

export interface LoyaltyRules {
  earnBahtPerPoint: number;
  redeemPointsPerBaht: number;
  redeemStepPoints: number;
  redeemMinimumPoints: number;
  redeemMaxPercentOfSubtotal: number;
  tiers: LoyaltyTier[];
}

export interface LoyaltyStanding {
  points: number;
  /** ยอดที่จ่ายจริงสะสม — นับจากคำสั่งซื้อที่ร้านได้รับเงินแล้ว */
  lifetimeSpend: number;
  tier: LoyaltyTier;
  /** null = อยู่ระดับสูงสุดแล้ว */
  nextTier: (LoyaltyTier & { remaining: number }) | null;
}

export interface MyLoyalty extends LoyaltyStanding {
  rules: LoyaltyRules;
}

export type PointTransactionType =
  "EARN" | "REDEEM" | "REDEEM_REFUND" | "EARN_REVERSAL" | "ADJUSTMENT";

export interface PointTransaction {
  id: string;
  type: PointTransactionType;
  /** บวก = ได้ · ลบ = ใช้/ถูกหัก */
  delta: number;
  balanceAfter: number;
  description: string;
  orderNumber: string | null;
  createdAt: string;
}

export interface AdminPointTransaction extends PointTransaction {
  createdBy: { id: string; name: string | null; email: string } | null;
}

export interface PointTransactionList<T = PointTransaction> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminPointTransactionList extends PointTransactionList<AdminPointTransaction> {
  standing: LoyaltyStanding;
}

export interface AdjustPointsResult {
  /** false = คำขอซ้ำ (idempotencyKey เดิม) จึงไม่ได้ปรับเพิ่ม */
  applied: boolean;
  standing: LoyaltyStanding;
}

/** แต้มในหน้า checkout — ทุกตัวเลขคิดที่ server */
export interface CheckoutLoyalty {
  balance: number;
  tier: LoyaltyTier;
  maxRedeemablePoints: number;
  appliedPoints: number;
  pointsDiscount: number;
  /** เหตุผลที่ใช้แต้มตามที่ขอไม่ได้ — แสดงให้ผู้ใช้เห็นตรง ๆ */
  error: string | null;
  rules: LoyaltyRules;
}

/** ป้ายของรายการในประวัติแต้ม — ความหมายของแต่ละชนิดที่ลูกค้าเข้าใจได้ */
export const POINT_TRANSACTION_LABEL: Record<PointTransactionType, string> = {
  EARN: "ได้รับแต้ม",
  REDEEM: "ใช้เป็นส่วนลด",
  REDEEM_REFUND: "คืนแต้ม",
  EARN_REVERSAL: "หักแต้มคืน",
  ADJUSTMENT: "ร้านปรับแต้ม",
};
