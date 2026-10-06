import type { ProductCard } from "./catalog";

/**
 * การแนะนำสินค้า (STEP 46) — ตรงกับ DTO ของ `backend/src/services/recommendation.service.ts`
 */

/** สินค้าที่แนะนำ + เหตุผลที่ backend เขียนจากสิ่งที่ลูกค้าทำจริง */
export interface RecommendedItem {
  product: ProductCard;
  /** "คล้าย “X” ที่คุณถูกใจ" · "ลูกค้าที่ซื้อ “X” ซื้อชิ้นนี้ด้วย" · "ยอดนิยมในร้าน" */
  reason: string;
}

/**
 * - `PERSONAL` = มีอย่างน้อยหนึ่งชิ้นที่มาจากประวัติของคนนี้
 * - `POPULAR` = ไม่ได้ใช้ประวัติของใครเลย → **หน้าเว็บต้องเรียกว่า "ยอดนิยม" ไม่ใช่ "สำหรับคุณ"**
 */
export type RecommendationMode = "PERSONAL" | "POPULAR";

/** ทำไมถึงไม่ใช่รายการเฉพาะบุคคล — หน้าเว็บบอกลูกค้าตามนี้ */
export type RecommendationFallbackReason = "GUEST" | "OPTED_OUT" | "NO_HISTORY" | "NO_MATCH";

export interface ForYouResult {
  mode: RecommendationMode;
  fallbackReason: RecommendationFallbackReason | null;
  items: RecommendedItem[];
}

export interface ProductRecommendations {
  /** ลูกค้าคนอื่นซื้อพร้อมกันจริงในใบที่ร้านได้เงินแล้ว — ยังไม่มีคำสั่งซื้อ = ว่าง (ไม่เดา) */
  boughtTogether: RecommendedItem[];
  /** ลุคที่จัดชิ้นนี้ไว้ พร้อมชิ้นอื่นในลุคที่ยังขายได้ */
  looks: { slug: string; name: string; items: ProductCard[] }[];
  similar: RecommendedItem[];
}
