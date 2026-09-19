import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { WishlistListResult } from "@/types/catalog";

/**
 * อ่านรายการที่ถูกใจจากฝั่ง server (STEP 22)
 *
 * ใช้ `apiFetchAsUser` เพราะทุก endpoint ต้องล็อกอิน
 * (ส่ง session token ต่อเป็น `Authorization: Bearer` — production คนละโดเมน)
 *
 * `cache: "no-store"` เสมอ: ราคาและสถานะสต็อกต้องเป็นของจริง ณ ตอนเปิดหน้า
 * และรายการนี้เป็นข้อมูลส่วนตัว ห้ามถูกแคชร่วมกับคนอื่น
 */
export function fetchWishlistOnServer(params: URLSearchParams): Promise<WishlistListResult> {
  const qs = params.toString();

  return apiFetchAsUser<WishlistListResult>(`/api/wishlist${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

/**
 * สินค้าชุดนี้ชิ้นไหนอยู่ในรายการที่ถูกใจของผู้ใช้บ้าง
 *
 * แยกออกจาก `/api/products/:slug` โดยเจตนา — endpoint สินค้าเป็นของสาธารณะที่แคชร่วมกันทุกคน
 * ถ้าเอาข้อมูลรายบุคคลไปใส่ จะแคชไม่ได้อีกเลย
 *
 * ยังไม่ล็อกอิน (หรือ backend ตอบ 401/403) → คืนเซ็ตว่าง ไม่โยน error
 * เพราะหน้าสินค้าต้องเปิดดูได้แม้ยังไม่ล็อกอิน
 */
export async function fetchWishlistedIdsOnServer(productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();

  try {
    const result = await apiFetchAsUser<{ productIds: string[] }>(
      `/api/wishlist/contains?productIds=${productIds.map(encodeURIComponent).join(",")}`,
      { cache: "no-store" },
    );

    return new Set(result.productIds);
  } catch {
    return new Set();
  }
}
