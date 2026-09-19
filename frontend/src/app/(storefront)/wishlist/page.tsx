import { HeartOff, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { WishlistCard } from "@/features/wishlist/components/wishlist-card";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchWishlistOnServer } from "@/services/wishlist.server";
import type { WishlistListResult, WishlistSort } from "@/types/catalog";

export const metadata: Metadata = {
  title: "Wishlist — รายการที่ถูกใจ",
  description: "สินค้าที่คุณกดถูกใจไว้ พร้อมราคาและสถานะสต็อกล่าสุด และป้ายบอกเมื่อราคาลดลง",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/wishlist", ["sort", "onlyPriceDrop"]);

const SORTS: ReadonlyArray<{ value: WishlistSort; label: string }> = [
  { value: "newest", label: "เพิ่มล่าสุด" },
  { value: "price-drop", label: "ลดราคามากสุด" },
  { value: "price-asc", label: "ราคาน้อย → มาก" },
  { value: "price-desc", label: "ราคามาก → น้อย" },
];

/**
 * หน้ารายการที่ถูกใจ /wishlist (STEP 22)
 *
 * - **ต้องล็อกอิน** — `Wishlist.userId` เป็น non-nullable ไม่มีแบบ guest
 *   (ต่างจากตะกร้าที่ guest ใช้ได้ จึงไม่ต้องแวะ `/api/cart/merge` ก่อน)
 * - ราคาและสถานะสต็อกคำนวณที่ backend ทุกครั้ง · ไม่ cache เพราะเป็นข้อมูลส่วนตัวและเปลี่ยนตลอด
 * - ป้าย "ราคาลด" เทียบราคาปัจจุบันกับ `priceWhenAdded` ที่บันทึกไว้ตอนกดถูกใจ
 */
export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/wishlist")}`);
  }

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeSort = (params.get("sort") ?? "newest") as WishlistSort;
  const onlyPriceDrop = params.get("onlyPriceDrop") === "true";

  let result: WishlistListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchWishlistOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการที่ถูกใจไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Wishlist
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">รายการที่ถูกใจ</h1>
        <p className="mt-2 text-sm text-muted">
          เก็บสินค้าที่ชอบไว้ดูทีหลัง — ราคาและสถานะสต็อกอัปเดตตามจริงทุกครั้งที่เปิดหน้านี้
        </p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : result.summary.total === 0 ? (
        <EmptyWishlist />
      ) : (
        <>
          {/* สรุปยอด — นับจากทั้งรายการ ไม่ใช่แค่หน้าปัจจุบัน */}
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-[var(--radius-pill)] border border-line bg-white px-3 py-1.5 font-semibold">
              ทั้งหมด {result.summary.total} ชิ้น
            </span>

            {result.summary.priceDropCount > 0 && (
              <Link
                href={withParam(params, "onlyPriceDrop", onlyPriceDrop ? null : "true")}
                aria-pressed={onlyPriceDrop}
                className={cn(
                  "flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 font-semibold transition",
                  onlyPriceDrop
                    ? "border-success bg-success text-white"
                    : "border-success/30 bg-success/5 text-success hover:bg-success/10",
                )}
              >
                <TrendingDown className="size-4" aria-hidden />
                ราคาลดลง {result.summary.priceDropCount} ชิ้น
              </Link>
            )}

            {result.summary.outOfStockCount > 0 && (
              <span className="rounded-[var(--radius-pill)] border border-warning/30 bg-warning/5 px-3 py-1.5 font-semibold text-warning">
                ของหมด {result.summary.outOfStockCount} ชิ้น
              </span>
            )}
          </div>

          <nav aria-label="เรียงลำดับ" className="mt-4 flex flex-wrap gap-2">
            {SORTS.map((option) => (
              <Link
                key={option.value}
                href={withParam(params, "sort", option.value === "newest" ? null : option.value)}
                aria-current={activeSort === option.value ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                  activeSort === option.value
                    ? "border-brand bg-brand text-white"
                    : "border-line hover:border-brand-soft hover:bg-lilac-50",
                )}
              >
                {option.label}
              </Link>
            ))}
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <NoMatch />
            ) : (
              <div className="space-y-6">
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {result.items.map((item) => (
                    <li key={item.id}>
                      <WishlistCard item={item} />
                    </li>
                  ))}
                </ul>

                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  hrefFor={(page) => withParam(params, "page", page)}
                />
              </div>
            )}
          </div>

          {/**
           * ⚠️ บอกตรง ๆ ว่ายังไม่มีการแจ้งเตือนทางอีเมลจริง
           * SMTP ยังไม่ได้ตั้งค่า (ดู config/notification.ts) การส่งจริงเป็นงานของ STEP 24/50
           * ถ้าไม่บอก ลูกค้าจะเข้าใจว่ากดเปิดแล้วจะมีอีเมลมาเตือนซึ่งไม่เป็นความจริง
           */}
          <p className="mt-8 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-4 py-3 text-xs text-muted">
            ตอนนี้ร้านยังไม่ได้เปิดการส่งอีเมลแจ้งเตือน — การเปิดสวิตช์
            &ldquo;เตือนเมื่อลดราคา&rdquo; จะบันทึกความต้องการของคุณไว้ก่อน
            ส่วนป้ายราคาลดบนหน้านี้อัปเดตตามจริงทุกครั้งที่เปิดหน้า
          </p>
        </>
      )}
    </main>
  );
}

/** ยังไม่เคยกดถูกใจอะไรเลย — ไม่ใช่ error */
function EmptyWishlist() {
  return (
    <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <HeartOff className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">ยังไม่มีสินค้าที่ถูกใจ</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        กดรูปหัวใจที่หน้าสินค้าเพื่อเก็บไว้ดูทีหลัง แล้วเราจะบอกให้รู้เมื่อราคาถูกลงกว่าตอนที่คุณกด
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/shop"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          เลือกซื้อสินค้า
        </Link>
        <Link
          href="/looks"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-white"
        >
          ดูลุคแนะนำ
        </Link>
      </div>
    </div>
  );
}

/** มีของถูกใจอยู่ แต่ตัวกรองปัจจุบันไม่ตรงกับอะไรเลย */
function NoMatch() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
      <p className="font-extrabold">ไม่มีรายการที่ตรงกับตัวกรองนี้</p>
      <p className="mt-2 text-sm text-muted">ลองเอาตัวกรองออกเพื่อดูรายการทั้งหมด</p>
      <Link
        href="/wishlist"
        className="mt-5 inline-flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line bg-white px-6 text-sm font-semibold transition hover:border-brand-soft"
      >
        ดูทั้งหมด
      </Link>
    </div>
  );
}
