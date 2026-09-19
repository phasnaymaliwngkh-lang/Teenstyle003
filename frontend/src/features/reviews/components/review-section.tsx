import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  fetchProductReviewsOnServer,
  fetchReviewEligibilityOnServer,
} from "@/services/review.server";
import type { ReviewEligibility, ReviewListResult, ReviewSort } from "@/types/catalog";

import { RatingStars } from "./rating-stars";
import { ReviewCard } from "./review-card";
import { ReviewComposer } from "./review-composer";

const SORTS: ReadonlyArray<{ value: ReviewSort; label: string }> = [
  { value: "newest", label: "ล่าสุด" },
  { value: "helpful", label: "มีประโยชน์มากสุด" },
  { value: "rating-desc", label: "ดาวมาก → น้อย" },
  { value: "rating-asc", label: "ดาวน้อย → มาก" },
];

/** ชื่อพารามิเตอร์ใส่คำนำหน้า `review` กันชนกับพารามิเตอร์อื่นของหน้าสินค้าในอนาคต */
const SORT_KEY = "reviewSort";
const RATING_KEY = "reviewRating";
const PAGE_KEY = "reviewPage";

/** ลิงก์ของส่วนรีวิวต้องพาไปที่หัวข้อรีวิวเสมอ ไม่งั้นกดแล้วเด้งกลับไปบนสุดของหน้าสินค้า */
function hrefWith(
  slug: string,
  params: URLSearchParams,
  key: string,
  value: string | number | null,
): string {
  const next = new URLSearchParams(params);

  if (value === null || value === "") next.delete(key);
  else next.set(key, String(value));

  // เปลี่ยนตัวกรองหรือการเรียงแล้วต้องกลับไปหน้าแรกของรีวิว ไม่งั้นอาจเจอหน้าว่าง
  if (key !== PAGE_KEY) next.delete(PAGE_KEY);

  const qs = next.toString();
  return `/product/${slug}${qs ? `?${qs}` : ""}#reviews`;
}

/**
 * ส่วนรีวิวบนหน้าสินค้า (STEP 23)
 *
 * เป็น Server Component ที่ stream แยกจากข้อมูลสินค้า — รีวิวโหลดช้าหรือพัง
 * ต้องไม่ทำให้ราคาและปุ่มซื้อหายไป (กฎ STEP 5 ข้อ 1)
 *
 * ⚠️ ส่วนนี้ **ห้ามอยู่ในเส้นทางที่ตัดสิน 404 ของหน้าสินค้า** — หน้าสินค้า `await`
 *    ข้อมูลหลักไปแล้วก่อนถึงตรงนี้ การ stream ต่อจากนั้นจึงไม่กระทบ HTTP status
 */
export async function ReviewSection({
  slug,
  productId,
  isSignedIn,
  params,
}: {
  slug: string;
  productId: string;
  isSignedIn: boolean;
  params: URLSearchParams;
}) {
  const sort = (params.get(SORT_KEY) ?? "newest") as ReviewSort;
  const ratingFilter = params.get(RATING_KEY);
  const page = Number(params.get(PAGE_KEY) ?? "1") || 1;

  const query = new URLSearchParams({ page: String(page), limit: "10", sort });
  if (ratingFilter) query.set("rating", ratingFilter);

  let result: ReviewListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchProductReviewsOnServer(slug, query, isSignedIn);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรีวิวไม่สำเร็จ";
  }

  // ถามสิทธิ์รีวิวเฉพาะตอนล็อกอิน — ไม่ล็อกอินก็รู้อยู่แล้วว่าเขียนไม่ได้
  let eligibility: ReviewEligibility | null = null;
  if (isSignedIn) {
    const map = await fetchReviewEligibilityOnServer([productId]);
    eligibility = map.get(productId) ?? null;
  }

  const signInHref = `/signin?callbackUrl=${encodeURIComponent(`/product/${slug}`)}`;

  return (
    <section id="reviews" className="scroll-mt-24">
      <h2 className="text-2xl sm:text-3xl">รีวิวจากคนที่ซื้อจริง</h2>
      <p className="mt-2 text-sm text-muted">
        ร้านเปิดให้รีวิวเฉพาะลูกค้าที่สั่งซื้อและได้รับสินค้าแล้ว
        และทุกรีวิวผ่านการตรวจก่อนขึ้นหน้านี้
      </p>

      {errorMessage !== null ? (
        <div className="mt-6">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <Summary slug={slug} params={params} result={result} activeRating={ratingFilter} />

            <ReviewComposer
              productId={productId}
              isSignedIn={isSignedIn}
              signInHref={signInHref}
              eligibility={eligibility}
              myReview={result.myReview}
            />
          </div>

          <div className="min-w-0 space-y-4">
            {result.summary.total > 0 && (
              <nav aria-label="เรียงลำดับรีวิว" className="flex flex-wrap gap-2">
                {SORTS.map((option) => (
                  <Link
                    key={option.value}
                    href={hrefWith(
                      slug,
                      params,
                      SORT_KEY,
                      option.value === "newest" ? null : option.value,
                    )}
                    aria-current={sort === option.value ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                      sort === option.value
                        ? "border-brand bg-brand text-white"
                        : "border-line hover:border-brand-soft hover:bg-lilac-50",
                    )}
                  >
                    {option.label}
                  </Link>
                ))}
              </nav>
            )}

            {/* รีวิวของตัวเองปักไว้บนสุดเสมอ รวมถึงตอนที่ยังรอตรวจสอบ */}
            {result.myReview !== null && (
              <ReviewCard
                review={result.myReview}
                isSignedIn={isSignedIn}
                signInHref={signInHref}
              />
            )}

            {result.items.length === 0 ? (
              <EmptyReviews
                hasAny={result.summary.total > 0}
                hasFilter={ratingFilter !== null}
                clearHref={hrefWith(slug, params, RATING_KEY, null)}
              />
            ) : (
              <>
                {result.items.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    isSignedIn={isSignedIn}
                    signInHref={signInHref}
                  />
                ))}

                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  hrefFor={(target) => hrefWith(slug, params, PAGE_KEY, target)}
                />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * คะแนนเฉลี่ย + กราฟแท่ง + ตัวกรองตามดาว
 *
 * ⚠️ ยังไม่มีรีวิวต้องบอกว่า "ยังไม่มีรีวิว" **ห้ามแสดง 0.0 ดาวเป็นคะแนน**
 *    เพราะ 0 ดาวหมายถึง "แย่มาก" ซึ่งไม่ใช่ความจริง (กฎเดียวกับป้ายกระดิ่งของ STEP 16 ข้อ 8)
 */
function Summary({
  slug,
  params,
  result,
  activeRating,
}: {
  slug: string;
  params: URLSearchParams;
  result: ReviewListResult;
  activeRating: string | null;
}) {
  if (result.summary.total === 0) {
    /**
     * ⚠️ เจ้าของรีวิวที่ยังรอตรวจต้องไม่เห็นข้อความ "ยังไม่มีใครรีวิว"
     *    ทั้งที่รีวิวของเขาอยู่ข้าง ๆ — คะแนนเฉลี่ยนับเฉพาะรีวิวที่อนุมัติแล้วก็จริง
     *    แต่ข้อความต้องอธิบายเหตุผลนั้น ไม่ใช่ทำเหมือนรีวิวของเขาไม่มีอยู่
     */
    const waitingForMine = result.myReview !== null;

    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-white p-5 text-center">
        <p className="font-extrabold">
          {waitingForMine ? "ยังไม่มีรีวิวที่แสดงอยู่" : "ยังไม่มีรีวิว"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {waitingForMine
            ? "คะแนนเฉลี่ยจะขึ้นเมื่อร้านอนุมัติรีวิวแล้ว — รีวิวของคุณอยู่ระหว่างตรวจสอบ"
            : "สินค้าชิ้นนี้ยังไม่มีใครรีวิว — ถ้าคุณเคยซื้อแล้ว มารีวิวเป็นคนแรกได้เลย"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <div className="flex items-center gap-4">
        <p className="text-4xl font-extrabold text-brand-dark">
          {result.summary.average.toFixed(1)}
        </p>
        <div>
          <RatingStars value={result.summary.average} size="lg" />
          <p className="mt-1 text-xs text-muted">
            จาก {result.summary.total.toLocaleString("th-TH")} รีวิว
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5">
        {result.summary.distribution.map((bucket) => {
          const selected = activeRating === String(bucket.rating);

          return (
            <li key={bucket.rating}>
              <Link
                href={hrefWith(slug, params, RATING_KEY, selected ? null : String(bucket.rating))}
                aria-pressed={selected}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-2 text-xs transition",
                  selected ? "bg-lilac font-bold" : "hover:bg-lilac-50",
                )}
              >
                <span className="w-10 shrink-0 font-semibold">{bucket.rating} ดาว</span>
                <span
                  aria-hidden
                  className="h-2 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-line"
                >
                  <span
                    className="block h-full rounded-[var(--radius-pill)] bg-warning"
                    style={{ width: `${bucket.percent}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-muted">
                  {bucket.count.toLocaleString("th-TH")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {activeRating !== null && (
        <Link
          href={hrefWith(slug, params, RATING_KEY, null)}
          className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-brand hover:underline"
        >
          ล้างตัวกรองดาว
        </Link>
      )}
    </div>
  );
}

function EmptyReviews({
  hasAny,
  hasFilter,
  clearHref,
}: {
  hasAny: boolean;
  hasFilter: boolean;
  clearHref: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
      <p className="font-extrabold">
        {hasFilter ? "ไม่มีรีวิวที่ตรงกับดาวที่เลือก" : "ยังไม่มีรีวิวที่แสดงได้"}
      </p>
      <p className="mt-2 text-sm text-muted">
        {hasFilter
          ? "ลองเอาตัวกรองออกเพื่อดูรีวิวทั้งหมด"
          : hasAny
            ? "รีวิวทั้งหมดของสินค้าชิ้นนี้เป็นของคุณเอง แสดงอยู่ด้านบนแล้ว"
            : "เป็นคนแรกที่เล่าให้คนอื่นฟังได้เลย"}
      </p>

      {hasFilter && (
        <Link
          href={clearHref}
          className="mt-5 inline-flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line bg-white px-6 text-sm font-semibold transition hover:border-brand-soft"
        >
          ดูรีวิวทั้งหมด
        </Link>
      )}
    </div>
  );
}
