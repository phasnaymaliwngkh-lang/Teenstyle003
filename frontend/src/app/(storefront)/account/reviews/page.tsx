import { MessageSquareDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { MyReviewCard } from "@/features/reviews/components/my-review-card";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { fetchMyReviewsOnServer } from "@/services/review.server";
import type { MyReviewListResult } from "@/types/catalog";

export const metadata: Metadata = {
  title: "รีวิวของฉัน",
  description: "รีวิวที่คุณเขียนไว้ พร้อมสถานะว่าแสดงบนหน้าสินค้าแล้วหรือยัง",
  robots: { index: false, follow: false },
};

/**
 * หน้ารีวิวของฉัน /account/reviews (STEP 23)
 *
 * ⚠️ ที่นี่คือที่เดียวที่ลูกค้าเห็น **ทุกสถานะ** ของรีวิวตัวเอง รวมถึงที่ถูกซ่อนหรือไม่อนุมัติ
 *    ถ้าไม่มีหน้านี้ รีวิวที่ร้านเอาลงจะหายไปเงียบ ๆ โดยเจ้าของไม่มีทางรู้ว่าเกิดอะไรขึ้น
 */
export default async function MyReviewsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/reviews")}`);
  }

  const params = toSearchParams(await searchParams);

  let result: MyReviewListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchMyReviewsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรีวิวของคุณไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          My Reviews
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">รีวิวของฉัน</h1>
        <p className="mt-2 text-sm text-muted">
          ทุกรีวิวต้องผ่านการตรวจจากร้านก่อนขึ้นหน้าสินค้า — ที่นี่บอกสถานะของแต่ละฉบับตามจริง
        </p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : result.total === 0 ? (
        <EmptyReviews />
      ) : (
        <div className="mt-8 space-y-4">
          <p className="text-sm font-semibold text-muted">
            ทั้งหมด {result.total.toLocaleString("th-TH")} รีวิว
          </p>

          {result.items.map((review) => (
            <MyReviewCard key={review.id} review={review} />
          ))}

          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            hrefFor={(page) => `/account/reviews?page=${page}`}
          />
        </div>
      )}
    </main>
  );
}

/** ยังไม่เคยเขียนรีวิว — ไม่ใช่ error */
function EmptyReviews() {
  return (
    <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <MessageSquareDashed className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">ยังไม่มีรีวิวของคุณ</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        รีวิวได้เมื่อได้รับสินค้าแล้ว — เปิดคำสั่งซื้อที่ส่งถึงแล้ว
        จะเห็นปุ่มเขียนรีวิวอยู่ข้างสินค้าแต่ละชิ้น
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/account/orders"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ดูคำสั่งซื้อของฉัน
        </Link>
        <Link
          href="/shop"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-white"
        >
          เลือกซื้อสินค้า
        </Link>
      </div>
    </div>
  );
}
