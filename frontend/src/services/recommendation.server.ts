import "server-only";

import { apiFetch } from "@/lib/api";
import { apiFetchAsUser } from "@/lib/api-server";
import type { ForYouResult, ProductRecommendations } from "@/types/recommendation";

/**
 * อ่านการแนะนำสินค้าจากฝั่ง server (STEP 46)
 *
 * ⚠️ **"สำหรับคุณ" ของคนที่ล็อกอินห้ามแคชร่วมกัน** — คำตอบสร้างจากประวัติของคนนั้น
 *    ถ้าแคชด้วย cache key เดียวกับคนอื่น ลูกค้าคนถัดไปจะเห็นเหตุผลที่อ้างสินค้าที่ "คนก่อนหน้า" ถูกใจ
 *    → ล็อกอินแล้วใช้ `apiFetchAsUser` + `no-store` เสมอ
 *
 * ยังไม่ล็อกอิน → คำตอบคือยอดนิยมชุดเดียวกันสำหรับทุกคน จึงแคชได้ (`revalidate: 60`)
 * (backend ตอบ `Cache-Control: private, no-store` ทุกครั้งเพื่อกัน CDN/เบราว์เซอร์
 *  แต่ data cache ของ Next ตัดสินจากตัวเลือกของ fetch ฝั่งนี้ ไม่ใช่จาก header)
 */
export function fetchForYouOnServer(isSignedIn: boolean, limit: number): Promise<ForYouResult> {
  const path = `/api/recommendations/for-you?limit=${limit}`;

  if (isSignedIn) {
    return apiFetchAsUser<ForYouResult>(path, { cache: "no-store" });
  }

  return apiFetch<ForYouResult>(path, {
    next: { revalidate: 60, tags: ["products"] },
  });
}

/**
 * สินค้าที่ซื้อด้วยกัน · ลุคที่มีชิ้นนี้ · สินค้าคล้ายกัน — เหมือนกันสำหรับทุกคน จึงแคชได้
 * (ไม่มีข้อมูลรายบุคคล — กฎเดียวกับ `/api/products/:slug` ของ STEP 22 ข้อ 7)
 */
export function fetchProductRecommendations(slug: string): Promise<ProductRecommendations> {
  return apiFetch<ProductRecommendations>(
    `/api/products/${encodeURIComponent(slug)}/recommendations`,
    { next: { revalidate: 60, tags: ["products", `product:${slug}`] } },
  );
}
