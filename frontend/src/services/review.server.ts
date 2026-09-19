import "server-only";

import { apiFetch } from "@/lib/api";
import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AdminReviewListResult,
  MyReviewListResult,
  ReviewEligibility,
  ReviewListResult,
} from "@/types/catalog";

/**
 * อ่านรีวิวจากฝั่ง server (STEP 23)
 *
 * ⚠️ **รายการรีวิวต้องยิงด้วย `apiFetchAsUser` เมื่อผู้ใช้ล็อกอินอยู่**
 *    ไม่งั้นคนที่เพิ่งเขียนรีวิวจะไม่เห็นรีวิวของตัวเองที่ยังรอตรวจ (`myReview`)
 *    และไม่รู้ว่าเคยกด "มีประโยชน์" ไว้ที่ไหน
 *
 * ยังไม่ล็อกอิน → ยิงแบบสาธารณะผ่าน `apiFetch` ซึ่งแคชได้ (`revalidate`)
 * เพราะคำตอบเหมือนกันสำหรับทุกคน
 */
export function fetchProductReviewsOnServer(
  slug: string,
  params: URLSearchParams,
  isSignedIn: boolean,
): Promise<ReviewListResult> {
  const qs = params.toString();
  const path = `/api/products/${encodeURIComponent(slug)}/reviews${qs ? `?${qs}` : ""}`;

  if (isSignedIn) {
    return apiFetchAsUser<ReviewListResult>(path, { cache: "no-store" });
  }

  return apiFetch<ReviewListResult>(path, {
    next: { revalidate: 60, tags: [`reviews:${slug}`] },
  });
}

/**
 * ผู้ใช้รีวิวสินค้าชุดนี้ได้หรือยัง
 *
 * ถามทีเดียวหลายสินค้าได้ (หน้าคำสั่งซื้อถามทั้งใบในคำขอเดียว)
 * ยังไม่ล็อกอิน หรือ backend ตอบ 401/403 → คืน map ว่าง ไม่โยน error
 * เพราะหน้าที่เรียกต้องแสดงผลได้ตามปกติแม้ไม่รู้สิทธิ์
 */
export async function fetchReviewEligibilityOnServer(
  productIds: string[],
): Promise<Map<string, ReviewEligibility>> {
  if (productIds.length === 0) return new Map();

  try {
    const result = await apiFetchAsUser<{ items: ReviewEligibility[] }>(
      `/api/reviews/eligibility?productIds=${productIds.map(encodeURIComponent).join(",")}`,
      { cache: "no-store" },
    );

    return new Map(result.items.map((item) => [item.productId, item]));
  } catch {
    return new Map();
  }
}

/** รีวิวทั้งหมดของตัวเอง (หน้า /account/reviews) — เห็นทุกสถานะ รวมที่ยังรอตรวจ */
export function fetchMyReviewsOnServer(params: URLSearchParams): Promise<MyReviewListResult> {
  const qs = params.toString();

  return apiFetchAsUser<MyReviewListResult>(`/api/reviews/me${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

/** คิวตรวจรีวิวของหลังบ้าน (ต้องมีสิทธิ์ review:moderate) */
export function fetchAdminReviewsOnServer(params: URLSearchParams): Promise<AdminReviewListResult> {
  const qs = params.toString();

  return apiFetchAsUser<AdminReviewListResult>(`/api/admin/reviews${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}
