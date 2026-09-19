import { apiFetch } from "@/lib/api";
import type { AdminReview, MyReview, ReviewStatus } from "@/types/catalog";

/**
 * รีวิวสินค้า — ฝั่ง client (STEP 23)
 *
 * ⚠️ client ส่งได้แค่ **ดาว หัวข้อ ข้อความ และรหัสสินค้า**
 *    `orderId` · `isVerifiedPurchase` · `status` backend หาเองจากคำสั่งซื้อจริง
 *    ถ้าส่งมาจะถูก Zod ตัดทิ้ง (มี test ยืนยัน)
 */

export interface SubmitReviewResult {
  review: MyReview;
  /** true เสมอในตอนนี้ — รีวิวทุกฉบับต้องผ่านการตรวจก่อนขึ้นหน้าร้าน */
  needsApproval: boolean;
}

export function createReview(input: {
  productId: string;
  rating: number;
  title?: string;
  comment: string;
}): Promise<SubmitReviewResult> {
  return apiFetch<SubmitReviewResult>("/api/reviews", {
    method: "POST",
    json: input,
    cache: "no-store",
  });
}

export function updateReview(
  reviewId: string,
  input: { rating?: number; title?: string | null; comment?: string },
): Promise<SubmitReviewResult> {
  return apiFetch<SubmitReviewResult>(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

export function deleteReview(reviewId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
}

export function setReviewHelpful(
  reviewId: string,
  helpful: boolean,
): Promise<{ helpfulCount: number; votedHelpful: boolean }> {
  return apiFetch<{ helpfulCount: number; votedHelpful: boolean }>(
    `/api/reviews/${encodeURIComponent(reviewId)}/helpful`,
    { method: "PATCH", json: { helpful }, cache: "no-store" },
  );
}

/** หลังบ้าน — อนุมัติ / ซ่อน / ปฏิเสธรีวิว (ต้องมีสิทธิ์ review:moderate) */
export function moderateReview(
  reviewId: string,
  input: { status: Exclude<ReviewStatus, "PENDING">; adminNote?: string | null },
): Promise<AdminReview> {
  return apiFetch<AdminReview>(`/api/admin/reviews/${encodeURIComponent(reviewId)}/status`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}
