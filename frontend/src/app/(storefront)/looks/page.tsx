import type { Metadata } from "next";
import { Suspense } from "react";

import { Pagination } from "@/components/shared/pagination";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/shared/section";
import { LookCard } from "@/features/looks/components/look-card";
import { LooksFilterBar } from "@/features/looks/components/looks-filter-bar";
import {
  toSearchParams,
  withClearedFilters,
  withParam,
  type RawSearchParams,
} from "@/features/looks/lib/query";
import { ApiClientError } from "@/lib/api";
import { canonicalPath, NOINDEX_FOLLOW } from "@/lib/seo";
import { fetchLookFilters, searchLooks } from "@/services/catalog.service";

/** metadata ขึ้นกับ query string — เหตุผลเดียวกับ /shop (ดูคอมเมนต์ที่นั่น) */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const raw = await searchParams;
  const query = typeof raw.q === "string" ? raw.q.trim() : "";

  return {
    title: query === "" ? "Look Ideas — ไอเดียการแต่งตัว" : `ค้นหาลุค "${query}"`,
    description:
      "ไอเดียการแต่งตัวที่จัดชุดไว้แล้ว เลือกตามสไตล์ Street, Korean, Minimal, Party พร้อมราคารวมของทั้งลุคจากสินค้าจริงในร้าน",
    alternates: { canonical: canonicalPath("/looks", raw, ["style", "page"]) },
    robots: query === "" ? undefined : NOINDEX_FOLLOW,
  };
}

/**
 * หน้า /looks (STEP 7)
 *
 * ลุคทุกชุดมาจากฐานข้อมูลจริง — ราคารวม จำนวนชิ้น และสถานะ "ซื้อครบชุดได้"
 * คำนวณที่ backend ทั้งหมด (ห้ามบวกราคาหรือเดาสต็อกฝั่ง client)
 *
 * กรอง/ค้นหา/เรียง/แบ่งหน้า อยู่ใน query string จึง render ฝั่ง server ได้และแชร์ลิงก์ได้
 * หน้ารายละเอียดลุค `/looks/[slug]` จะมาใน STEP 8 — ตอนนี้การ์ดจึงยังไม่ลิงก์ไปที่นั้น
 * แต่ขยายดูสินค้าในลุคได้ และแต่ละชิ้นลิงก์ไปหน้าสินค้าจริง
 */
export default async function LooksPage({
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
          Look Ideas
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">ไอเดียการแต่งตัว</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          ชุดที่จัดไว้แล้วพร้อมใส่ตามได้ทันที — ราคารวมคิดจากสินค้าจริงในร้าน และบอกตรง ๆ
          ว่าลุคนี้ยังซื้อครบชุดได้ไหม
        </p>
      </header>

      <div className="mt-8 space-y-6">
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterSection params={params} />
        </Suspense>

        <Suspense
          key={params.toString()}
          fallback={<SectionSkeleton count={4} aspect="aspect-3/4" />}
        >
          <ResultsSection params={params} />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * แถบกรอง — แยก section เพื่อให้ error ของมันไม่ล้มรายการลุค
 * (ห้ามสร้าง JSX ใน try/catch ตามกฎ react-hooks/error-boundaries)
 */
async function FilterSection({ params }: { params: URLSearchParams }) {
  let filters: Awaited<ReturnType<typeof fetchLookFilters>> | null = null;
  let errorMessage: string | null = null;

  try {
    filters = await fetchLookFilters();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดตัวกรองไม่สำเร็จ";
  }

  if (errorMessage !== null) {
    return <SectionError message={errorMessage} />;
  }

  if (!filters) return null;

  return <LooksFilterBar filters={filters} params={params} />;
}

async function ResultsSection({ params }: { params: URLSearchParams }) {
  let result: Awaited<ReturnType<typeof searchLooks>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await searchLooks(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก";
  }

  if (errorMessage !== null) {
    return <SectionError message={errorMessage} />;
  }

  if (!result) return null;

  if (result.items.length === 0) {
    return (
      <div className="space-y-4">
        <SectionEmpty
          message="ไม่พบลุคที่ตรงกับเงื่อนไข"
          hint="ลองเอาตัวกรองบางอันออก หรือใช้คำค้นที่สั้นลง"
        />
        <p className="text-center">
          <a href={withClearedFilters(params)} className="text-sm font-bold text-brand underline">
            ล้างตัวกรองทั้งหมด
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        พบ <strong className="text-ink">{result.total}</strong> ลุค · หน้า {result.page} /{" "}
        {result.totalPages}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {result.items.map((look) => (
          <LookCard key={look.id} look={look} detailHref={`/looks/${look.slug}`} showItems />
        ))}
      </div>

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        hrefFor={(page) => withParam(params, "page", page)}
      />

      <p className="text-center text-xs text-muted">
        กดที่ลุคเพื่อเลือกสี/ไซซ์ของทุกชิ้นแล้วตรวจสต็อกทั้งชุดในครั้งเดียว
      </p>
    </div>
  );
}

function FilterBarSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-12 animate-pulse rounded-[var(--radius-pill)] bg-lilac-50" />
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
        {Array.from({ length: 3 }, (_, row) => (
          <div key={row} className="mt-3 flex flex-wrap gap-2 first:mt-0">
            {Array.from({ length: 5 }, (_, chip) => (
              <div
                key={chip}
                className="h-9 w-24 animate-pulse rounded-[var(--radius-pill)] bg-lilac-50"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
