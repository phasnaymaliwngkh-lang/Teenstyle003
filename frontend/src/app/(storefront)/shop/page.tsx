import type { Metadata } from "next";
import { Suspense } from "react";

import { Pagination } from "@/components/shared/pagination";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/shared/section";
import { FilterPanel } from "@/features/shop/components/filter-panel";
import { ShopToolbar } from "@/features/shop/components/shop-toolbar";
import {
  toSearchParams,
  withClearedFilters,
  withParam,
  type RawSearchParams,
} from "@/features/shop/lib/query";
import { ProductCard } from "@/features/products/components/product-card";
import { ApiClientError } from "@/lib/api";
import { fetchShopFilters, searchShopProducts } from "@/services/catalog.service";

export const metadata: Metadata = {
  title: "Shop — เลือกซื้อเสื้อผ้าแฟชั่น",
  description:
    "เลือกซื้อเสื้อผ้าและสินค้าแฟชั่นวัยรุ่นหลากหลายสไตล์ กรองตามหมวดหมู่ แบรนด์ ไซซ์ สี และช่วงราคา",
};

/**
 * หน้า /shop (STEP 6)
 *
 * filter/sort/page ทั้งหมดอยู่ใน query string → หน้า render ฝั่ง server ได้
 * และ backend เป็นผู้กรองจริง (ไม่กรองฝั่ง client เพราะเชื่อ client ไม่ได้
 * และข้อมูลอาจมีมากกว่าที่ส่งมาหน้าเดียว)
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const params = toSearchParams(raw);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Shop
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">เลือกซื้อสินค้า</h1>
        <p className="mt-2 text-sm text-muted">
          กรองตามหมวดหมู่ แบรนด์ ไซซ์ สี และช่วงราคา — ราคาและสต็อกอัปเดตจากฐานข้อมูลจริง
        </p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[260px_1fr]">
        <Suspense fallback={<FilterSkeleton />}>
          <FilterPanelSection params={params} />
        </Suspense>

        <div className="min-w-0">
          <Suspense key={params.toString()} fallback={<ResultsSkeleton />}>
            <ResultsSection params={params} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/**
 * แผงกรอง — แยก section เพื่อให้ error ของมันไม่ล้มรายการสินค้า
 *
 * หมายเหตุ: ห้ามสร้าง JSX ใน try/catch (react-hooks/error-boundaries)
 * เพราะ error ตอน render จะไม่ถูกจับ — จึง await ใน try แล้วค่อย render ข้างนอก
 */
async function FilterPanelSection({ params }: { params: URLSearchParams }) {
  let filters: Awaited<ReturnType<typeof fetchShopFilters>> | null = null;
  let errorMessage: string | null = null;

  try {
    filters = await fetchShopFilters();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดตัวกรองไม่สำเร็จ";
  }

  if (errorMessage !== null) {
    return <SectionError message={errorMessage} />;
  }

  if (!filters) return null;

  return <FilterPanel filters={filters} params={params} />;
}

async function ResultsSection({ params }: { params: URLSearchParams }) {
  let result: Awaited<ReturnType<typeof searchShopProducts>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await searchShopProducts(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก";
  }

  if (errorMessage !== null) {
    return <SectionError message={errorMessage} />;
  }

  if (!result) return null;

  return (
    <div className="space-y-6">
      <ShopToolbar params={params} total={result.total} />

      {result.items.length === 0 ? (
        <SectionEmpty
          message="ไม่พบสินค้าที่ตรงกับเงื่อนไข"
          hint="ลองลดจำนวนตัวกรอง เปลี่ยนช่วงราคา หรือใช้คำค้นที่สั้นลง"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {result.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          <p className="text-center text-xs text-muted">
            แสดง {result.items.length} จาก {result.total} รายการ · หน้า {result.page} /{" "}
            {result.totalPages}
          </p>

          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            hrefFor={(page) => withParam(params, "page", page)}
          />
        </>
      )}

      {result.items.length === 0 && (
        <p className="text-center">
          <a href={withClearedFilters(params)} className="text-sm font-bold text-brand underline">
            ล้างตัวกรองทั้งหมด
          </a>
        </p>
      )}
    </div>
  );
}

function FilterSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-[var(--radius-card)] border border-line bg-white p-4">
          <div className="h-3.5 w-1/3 animate-pulse rounded bg-lilac" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="h-8 animate-pulse rounded bg-lilac-50" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-12 animate-pulse rounded-[var(--radius-pill)] bg-lilac-50" />
      <SectionSkeleton count={8} />
    </div>
  );
}
