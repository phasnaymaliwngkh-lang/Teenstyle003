import Link from "next/link";

import { fetchProductReviewsOnServer } from "@/services/review.server";

import { RatingStars } from "./rating-stars";

/**
 * คะแนนเฉลี่ยเล็ก ๆ ใต้ชื่อสินค้า (STEP 23)
 *
 * ยิงแบบสาธารณะเสมอ (ไม่ใช่ `apiFetchAsUser`) เพราะคะแนนเฉลี่ยเหมือนกันสำหรับทุกคน
 * จึงแคชร่วมกันได้และไม่ถ่วงหน้าสินค้า · ส่วนรีวิวรายบุคคลอยู่ในส่วนรีวิวด้านล่าง
 *
 * ⚠️ ยังไม่มีรีวิว → บอกตรง ๆ ว่ายังไม่มี **ห้ามแสดง 0.0 ดาว**
 *    เพราะ 0 ดาวหมายถึง "แย่มาก" ไม่ใช่ "ยังไม่มีข้อมูล"
 *
 * โหลดไม่สำเร็จ → ไม่แสดงอะไรเลย ดีกว่าโชว์คะแนนที่อาจไม่ใช่ของจริง
 */
export async function ProductRatingBadge({ slug }: { slug: string }) {
  let summary: { total: number; average: number } | null = null;

  try {
    const result = await fetchProductReviewsOnServer(
      slug,
      new URLSearchParams({ limit: "1" }),
      false,
    );
    summary = result.summary;
  } catch {
    return null;
  }

  if (summary.total === 0) {
    return (
      <Link href="#reviews" className="text-xs font-semibold text-muted hover:text-brand">
        ยังไม่มีรีวิว — เป็นคนแรกได้เลย
      </Link>
    );
  }

  return (
    <Link href="#reviews" className="flex items-center gap-2 text-xs transition hover:text-brand">
      <RatingStars value={summary.average} size="sm" hideLabel />
      <span className="font-bold">{summary.average.toFixed(1)}</span>
      <span className="text-muted">
        ({summary.total.toLocaleString("th-TH")} รีวิวจากคนที่ซื้อจริง)
      </span>
    </Link>
  );
}
