import type { ProductCardDto } from './product.model.ts';

/**
 * Wishlist DTO (STEP 22)
 *
 * ⚠️ ราคาที่แสดงทุกบาทมาจาก `toProductCards()` (ซึ่งคิดจาก [pricing.ts](./pricing.ts))
 *    ส่วน `priceWhenAdded` เป็น **snapshot ตอนกดถูกใจ** มีไว้เทียบว่าราคาลดลงหรือยังเท่านั้น
 *    **ห้ามนำไปคิดเงิน** (กฎเดียวกับ `CartItem.addedPrice` ของ STEP 9)
 */

export interface PriceDropDto {
  /** ถูกลงกี่บาทเทียบกับตอนกดถูกใจ */
  amount: number;
  /** ถูกลงกี่เปอร์เซ็นต์ ปัดเป็นจำนวนเต็ม */
  percent: number;
}

export interface WishlistItemDto {
  /** id ของแถว Wishlist */
  id: string;
  addedAt: string;
  /** ราคาที่ต้องจ่ายจริง ณ ตอนที่กดถูกใจ */
  priceWhenAdded: number;
  notifyOnPriceDrop: boolean;
  /** null = ราคายังไม่ถูกลงกว่าตอนกดถูกใจ */
  priceDrop: PriceDropDto | null;
  product: ProductCardDto;
  /**
   * ตัวเลือกเดียวที่กดเพิ่มลงตะกร้าได้ทันทีโดยไม่ต้องเลือกอะไรอีก
   *
   * null เมื่อสินค้ามีหลายตัวเลือก หรือไม่มีตัวเลือกไหนที่ซื้อได้เลย
   * → หน้าเว็บต้องพาไปเลือกที่หน้าสินค้าแทน **ห้ามเดาตัวเลือกให้ลูกค้า**
   */
  quickAddVariantId: string | null;
  /** จำนวนตัวเลือกที่ยังเปิดขายอยู่ — ใช้บอกผู้ใช้ว่าต้องไปเลือกสี/ไซซ์ก่อน */
  activeVariantCount: number;
}

export interface WishlistSummaryDto {
  /** จำนวนรายการทั้งหมดในรายการที่ถูกใจ */
  total: number;
  /** จำนวนรายการที่ราคาถูกลงกว่าตอนกดถูกใจ */
  priceDropCount: number;
  /** จำนวนรายการที่ตอนนี้ซื้อไม่ได้ (ของหมด) */
  outOfStockCount: number;
}

export interface WishlistListDto {
  items: WishlistItemDto[];
  summary: WishlistSummaryDto;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * คำนวณส่วนต่างราคาเทียบกับตอนกดถูกใจ
 *
 * คืน null เมื่อราคาเท่าเดิมหรือแพงขึ้น — เราแจ้งเฉพาะข่าวดี
 * และไม่แจ้งเมื่อ `priceWhenAdded` เป็น 0 เพราะคิดเปอร์เซ็นต์ไม่ได้
 */
export function resolvePriceDrop(
  priceWhenAdded: number,
  currentFinalPrice: number,
): PriceDropDto | null {
  if (priceWhenAdded <= 0) return null;

  const amount = priceWhenAdded - currentFinalPrice;
  if (amount <= 0) return null;

  return {
    amount,
    percent: Math.round((amount / priceWhenAdded) * 100),
  };
}
