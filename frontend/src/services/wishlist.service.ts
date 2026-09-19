import { apiFetch } from "@/lib/api";

/**
 * รายการที่ถูกใจ — ฝั่ง client (STEP 22)
 *
 * ใช้กับปุ่มหัวใจและปุ่มในหน้ารายการที่ถูกใจ ซึ่งต้องตอบสนองทันทีโดยไม่โหลดหน้าใหม่
 * ทุกคำขอ `cache: "no-store"` เพราะเป็นข้อมูลส่วนตัวและเปลี่ยนตลอด
 *
 * ⚠️ client ส่งได้แค่ `productId` — ราคาที่บันทึกไว้ (`priceWhenAdded`) backend อ่านจากฐานข้อมูลเอง
 */

export interface AddWishlistResult {
  /** false = อยู่ในรายการอยู่แล้ว (กดซ้ำ) */
  created: boolean;
  priceWhenAdded: number;
}

export function addToWishlist(productId: string): Promise<AddWishlistResult> {
  return apiFetch<AddWishlistResult>("/api/wishlist/items", {
    method: "POST",
    json: { productId },
    cache: "no-store",
  });
}

export function removeFromWishlist(productId: string): Promise<{ removed: boolean }> {
  return apiFetch<{ removed: boolean }>(`/api/wishlist/items/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
}

export function setWishlistNotify(
  productId: string,
  notifyOnPriceDrop: boolean,
): Promise<{ notifyOnPriceDrop: boolean }> {
  return apiFetch<{ notifyOnPriceDrop: boolean }>(
    `/api/wishlist/items/${encodeURIComponent(productId)}/notify`,
    {
      method: "PATCH",
      json: { notifyOnPriceDrop },
      cache: "no-store",
    },
  );
}
