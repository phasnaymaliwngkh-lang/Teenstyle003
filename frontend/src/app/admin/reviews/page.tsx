import { BadgeCheck, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { ReviewModeration } from "@/features/admin/components/review-moderation";
import { RatingStars } from "@/features/reviews/components/rating-stars";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminReviewsOnServer } from "@/services/review.server";
import type { AdminReviewListResult, ReviewStatus } from "@/types/catalog";

export const metadata: Metadata = {
  title: "ตรวจรีวิวสินค้า",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/reviews", ["status", "rating", "q"]);

/** `ALL` เป็นค่าของ URL เท่านั้น ไม่ได้ส่งไป backend — ไม่มีค่านี้ ตัวกรองจะเด้งกลับเป็น PENDING */
const ALL = "ALL";

const TABS: ReadonlyArray<{ value: ReviewStatus | typeof ALL; label: string }> = [
  { value: "PENDING", label: "รอตรวจสอบ" },
  { value: "APPROVED", label: "อนุมัติแล้ว" },
  { value: "HIDDEN", label: "ซ่อนอยู่" },
  { value: "REJECTED", label: "ไม่อนุมัติ" },
  { value: ALL, label: "ทั้งหมด" },
];

const STATUS_STYLE: Record<ReviewStatus, string> = {
  PENDING: "border-warning/30 bg-warning/5 text-warning",
  APPROVED: "border-success/30 bg-success/5 text-success",
  HIDDEN: "border-muted-light/40 bg-lilac-50 text-muted",
  REJECTED: "border-danger/30 bg-danger/5 text-danger",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "รอตรวจสอบ",
  APPROVED: "แสดงอยู่หน้าสินค้า",
  HIDDEN: "ซ่อนอยู่",
  REJECTED: "ไม่อนุมัติ",
};

/**
 * คิวตรวจรีวิวสินค้า (STEP 23)
 *
 * ⚠️ รีวิวใหม่ทุกฉบับเป็น `PENDING` และ **ยังไม่แสดงบนหน้าสินค้า** จนกว่าจะอนุมัติที่นี่
 *    ถ้าไม่มีใครเข้ามาตรวจ รีวิวของลูกค้าจะค้างอยู่เงียบ ๆ — แท็บแรกจึงเป็น "รอตรวจสอบ" เสมอ
 *
 * ⚠️ ตัวเลขข้างแท็บนับด้วยเงื่อนไขค้นหาชุดเดียวกับรายการ (backend คำนวณให้)
 *    กดแท็บแล้วจำนวนที่เห็นจึงตรงกับเลขบนแท็บเสมอ
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("review:moderate");

  const params = toSearchParams(await searchParams);

  // ไม่ได้เลือกแท็บมา = เปิดที่งานที่ค้างอยู่จริง
  const statusParam = params.get("status") ?? "PENDING";
  const activeStatus = statusParam === ALL ? null : (statusParam as ReviewStatus);

  const query = new URLSearchParams(params);
  if (activeStatus === null) query.delete("status");
  else query.set("status", activeStatus);

  let data: AdminReviewListResult | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminReviewsOnServer(query);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการรีวิวไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">ตรวจรีวิวสินค้า</h1>
          <p className="mt-1 text-sm text-muted">
            รีวิวทุกฉบับมาจากลูกค้าที่ซื้อและได้รับสินค้าแล้วเท่านั้น
            และจะไม่ขึ้นหน้าสินค้าจนกว่าจะอนุมัติที่นี่
          </p>
        </div>

        <Link
          href="/admin"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          กลับหน้าภาพรวม
        </Link>
      </header>

      <form action="/admin/reviews" className="mt-6 flex flex-wrap gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">ค้นหาในข้อความรีวิว หัวข้อ หรือชื่อสินค้า</span>
          <input
            type="search"
            name="q"
            defaultValue={params.get("q") ?? ""}
            placeholder="ค้นหาข้อความรีวิว หัวข้อ หรือชื่อสินค้า"
            className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line px-4 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <input type="hidden" name="status" value={statusParam} />
        <button
          type="submit"
          className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ค้นหา
        </button>
      </form>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : (
        <>
          <nav aria-label="กรองตามสถานะ" className="mt-4 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const isActive = statusParam === tab.value;
              const count = tab.value === ALL ? null : data.counts[tab.value];

              return (
                <Link
                  key={tab.label}
                  href={withParam(params, "status", tab.value)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                    isActive
                      ? "border-brand bg-brand text-white"
                      : "border-line hover:border-brand-soft hover:bg-lilac-50",
                  )}
                >
                  {tab.label}
                  {count !== null && (
                    <span
                      className={cn(
                        "rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold",
                        isActive ? "bg-white/25" : "bg-lilac text-brand-dark",
                      )}
                    >
                      {count.toLocaleString("th-TH")}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <p className="mt-4 text-sm text-muted" aria-live="polite">
            พบ {data.total.toLocaleString("th-TH")} รีวิว
            {params.get("q") ? ` สำหรับ "${params.get("q")}"` : ""}
            {" · "}ไม่รวมรีวิวที่ลูกค้าลบเอง
          </p>

          {data.items.length === 0 ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
              <Star className="mx-auto size-10 text-brand-soft" aria-hidden />
              <p className="mt-3 font-extrabold">ไม่มีรีวิวในเงื่อนไขนี้</p>
              <p className="mt-2 text-sm text-muted">
                {activeStatus === "PENDING"
                  ? "ไม่มีรีวิวค้างรอตรวจ — เรียบร้อยแล้ว"
                  : "ลองเปลี่ยนแท็บหรือคำค้นดู"}
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {data.items.map((review) => (
                <article
                  key={review.id}
                  className="rounded-[var(--radius-card)] border border-line bg-white p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold">
                        {review.product.slug !== null ? (
                          <Link
                            href={`/product/${review.product.slug}#reviews`}
                            className="transition hover:text-brand"
                          >
                            {review.product.name}
                          </Link>
                        ) : (
                          review.product.name
                        )}
                      </h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <RatingStars value={review.rating} size="sm" />
                        {review.isVerifiedPurchase && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
                            <BadgeCheck className="size-3.5" aria-hidden />
                            ซื้อจริง
                            {review.orderNumber !== null && ` · ${review.orderNumber}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <span
                      className={cn(
                        "rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-bold",
                        STATUS_STYLE[review.status],
                      )}
                    >
                      {STATUS_LABEL[review.status]}
                    </span>
                  </div>

                  {review.title !== null && (
                    <h3 className="mt-3 text-sm font-extrabold">{review.title}</h3>
                  )}

                  {/* ข้อความจากลูกค้า — render เป็น text ล้วน ไม่ใช่ HTML เพื่อกัน XSS */}
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
                    {review.comment}
                  </p>

                  <p className="mt-3 text-xs text-muted">
                    โดย {review.customer.name ?? "ไม่ระบุชื่อ"} ({review.customer.email}) ·{" "}
                    {new Date(review.createdAt).toLocaleString("th-TH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {review.helpfulCount > 0 &&
                      ` · มีประโยชน์ ${review.helpfulCount.toLocaleString("th-TH")} เสียง`}
                  </p>

                  {review.adminNote !== null && (
                    <p className="mt-2 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-3 py-2 text-xs text-ink-soft">
                      <span className="font-bold">หมายเหตุเดิม:</span> {review.adminNote}
                    </p>
                  )}

                  <div className="mt-4">
                    <ReviewModeration reviewId={review.id} currentStatus={review.status} />
                  </div>
                </article>
              ))}

              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                hrefFor={(page) => withParam(params, "page", page)}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
