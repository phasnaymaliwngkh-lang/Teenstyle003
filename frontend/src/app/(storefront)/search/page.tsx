import { AlertTriangle, BookOpen, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pagination } from "@/components/shared/pagination";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/shared/section";
import { LookCard } from "@/features/looks/components/look-card";
import { ProductCard } from "@/features/products/components/product-card";
import { SearchBox } from "@/features/search/components/search-box";
import {
  searchHref,
  shopHref,
  toSearchParams,
  withParam,
  type RawSearchParams,
} from "@/features/search/lib/query";
import { ApiClientError } from "@/lib/api";
import { NOINDEX_FOLLOW } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { fetchCategories } from "@/services/catalog.service";
import { fetchSearchResults } from "@/services/search.service";
import type { CategoryCard } from "@/types/catalog";
import type { SearchResult } from "@/types/search";

/**
 * หน้าผลค้นหาเป็นหน้าที่สร้างจากคำค้นได้ไม่จำกัด — ห้ามขึ้นดัชนี (เนื้อหาซ้ำกับหน้าสินค้า/หน้าร้าน)
 * แต่ให้บ็อตตามลิงก์ไปหน้าสินค้าได้ (กฎ STEP 33 ข้อ 6)
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.trim() : "";

  return {
    title: q === "" ? "ค้นหาสินค้า" : `ค้นหา “${q}”`,
    alternates: { canonical: "/search" },
    robots: NOINDEX_FOLLOW,
  };
}

const SORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "relevance", label: "ตรงที่สุด" },
  { value: "newest", label: "มาใหม่" },
  { value: "price-asc", label: "ราคาต่ำ → สูง" },
  { value: "price-desc", label: "ราคาสูง → ต่ำ" },
];

/**
 * ค้นหาทั้งร้าน /search (STEP 45)
 *
 * พิมพ์เป็นภาษาคนได้ ("เสื้อสีดำ ไม่เกิน 500 บาท") — backend ตีความด้วยคำศัพท์ของร้านเท่านั้น
 * แล้ว **ส่งกลับมาว่าเข้าใจว่าอะไร** หน้านี้ต้องแสดงทุกข้อ และให้ค้นแบบตรงตัวได้เสมอ
 * ผลทุกชิ้นมาจากฐานข้อมูลจริง · การ์ดสินค้าชุดเดียวกับ /shop (ราคา/สต็อกจาก server)
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = toSearchParams(await searchParams);
  const q = (params.get("q") ?? "").trim();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Search
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">
          {q === "" ? "ค้นหาสินค้า" : `ผลการค้นหา “${q}”`}
        </h1>
        <p className="mt-2 text-sm text-muted">
          พิมพ์ได้เหมือนพูด — ระบุสี ไซซ์ หรืองบได้เลย ระบบจะบอกว่าเข้าใจว่าอะไร
        </p>
        <div className="mt-5 max-w-2xl">
          {/* key = คำค้น: เปลี่ยนคำแล้วช่องต้องแสดงคำใหม่ (ช่องเก็บค่าที่พิมพ์ไว้ใน state ของมันเอง) */}
          <SearchBox key={q} initialQuery={q} autoFocus={q === ""} />
        </div>
      </header>

      <div className="mt-8">
        {q === "" ? (
          <Suspense fallback={<SectionSkeleton count={4} />}>
            <StartSection />
          </Suspense>
        ) : (
          <Suspense key={params.toString()} fallback={<SectionSkeleton count={8} />}>
            <ResultsSection params={params} />
          </Suspense>
        )}
      </div>
    </main>
  );
}

/** ยังไม่ได้พิมพ์อะไร — แนะนำหมวดที่มีอยู่จริง (ไม่ใช่ "คำค้นยอดนิยม" ที่ระบบไม่ได้เก็บ) */
async function StartSection() {
  let categories: CategoryCard[] | null = null;
  let errorMessage: string | null = null;

  try {
    categories = (await fetchCategories()).items;
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดหมวดหมู่ไม่สำเร็จ";
  }

  if (errorMessage !== null) return <SectionError message={errorMessage} />;
  if (categories === null) return null;

  const names = categories.flatMap((category) => [
    category.name,
    ...category.children.map((child) => child.name),
  ]);

  return (
    <section aria-labelledby="start-heading" className="space-y-6">
      <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-5 text-sm">
        <h2 id="start-heading" className="flex items-center gap-2 text-base font-extrabold">
          <Sparkles className="size-5 text-brand" aria-hidden />
          พิมพ์แบบไหนได้บ้าง
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
          <li>สี — “สีดำ” “ชมพู” “black” (ใช้สีที่ร้านมีจริง)</li>
          <li>ไซซ์ — “ไซซ์ M” “XL” “ฟรีไซซ์” “เบอร์ 38”</li>
          <li>งบ — “ไม่เกิน 500 บาท” “500-1,000” “1,000 ขึ้นไป”</li>
          <li>สถานะ — “พร้อมส่ง” “ลดราคา”</li>
        </ul>
      </div>

      {names.length === 0 ? (
        <SectionEmpty message="ยังไม่มีหมวดหมู่สินค้า" />
      ) : (
        <div>
          <h2 className="text-base font-extrabold">ค้นตามหมวด</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {names.map((name) => (
              <li key={name}>
                <Link
                  href={searchHref(name)}
                  className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                >
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

async function ResultsSection({ params }: { params: URLSearchParams }) {
  let result: SearchResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchSearchResults(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "ค้นหาไม่สำเร็จ";
  }

  if (errorMessage !== null) return <SectionError message={errorMessage} />;
  if (result === null) return null;

  const { products } = result;
  const unavailable = result.understood.filter((part) => !part.available);
  const activeSort = params.get("sort") ?? "relevance";

  return (
    <div className="space-y-8">
      <UnderstoodBar result={result} params={params} />

      {unavailable.length > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-5 text-sm"
        >
          <p className="flex items-center gap-2 font-bold text-warning">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            ร้านยังไม่มีสินค้า{unavailable.map((part) => part.label).join(" และ ")}
          </p>
          <p className="mt-1 text-ink-soft">
            ระบบไม่แสดงสินค้าอื่นแทนสิ่งที่คุณระบุ
            {result.terms.length > 0 && (
              <>
                {" "}
                · ลอง{" "}
                <Link
                  href={searchHref(result.terms.join(" "))}
                  className="font-semibold text-brand underline"
                >
                  ค้น “{result.terms.join(" ")}” โดยไม่ระบุเงื่อนไขนี้
                </Link>
              </>
            )}
          </p>
        </div>
      ) : products.total === 0 ? (
        <div className="space-y-4">
          <SectionEmpty
            message={`ไม่พบสินค้าที่ตรงกับ “${result.query}”`}
            hint="ลองใช้คำที่สั้นลง เขียนให้ต่างออกไป หรือลดเงื่อนไขสี/ไซซ์/งบ"
          />
          {result.suggestions.length > 0 && (
            <p className="text-center text-sm">
              คุณหมายถึง{" "}
              {result.suggestions.map((word, index) => (
                <span key={word}>
                  {index > 0 && " · "}
                  <Link href={searchHref(word)} className="font-semibold text-brand underline">
                    {word}
                  </Link>
                </span>
              ))}
              ?
            </p>
          )}
        </div>
      ) : (
        <section aria-labelledby="products-heading" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="products-heading" className="text-lg">
              สินค้า {products.total.toLocaleString("th-TH")} รายการ
            </h2>
            <Link
              href={shopHref(result.shopQuery)}
              className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              กรองต่อที่หน้าร้าน →
            </Link>
          </div>

          <nav aria-label="เรียงผลการค้นหา" className="flex flex-wrap gap-2">
            {SORTS.map((sort) => (
              <Link
                key={sort.value}
                href={withParam(params, "sort", sort.value === "relevance" ? null : sort.value)}
                aria-current={activeSort === sort.value ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                  activeSort === sort.value
                    ? "border-brand bg-brand text-white"
                    : "border-line hover:border-brand-soft hover:bg-lilac-50",
                )}
              >
                {sort.label}
              </Link>
            ))}
          </nav>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4" aria-live="polite">
            {products.items.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index === 0} />
            ))}
          </div>

          <Pagination
            page={products.page}
            totalPages={products.totalPages}
            hrefFor={(page) => withParam(params, "page", page)}
          />
        </section>
      )}

      {result.looks.length > 0 && (
        <section aria-labelledby="looks-heading" className="space-y-4">
          <h2 id="looks-heading" className="text-lg">
            ลุคที่เกี่ยวข้อง
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {result.looks.map((look) => (
              <LookCard key={look.id} look={look} detailHref={`/looks/${look.slug}`} />
            ))}
          </div>
        </section>
      )}

      {result.articles.length > 0 && (
        <section aria-labelledby="articles-heading" className="space-y-3">
          <h2 id="articles-heading" className="flex items-center gap-2 text-lg">
            <BookOpen className="size-5 text-brand" aria-hidden />
            คำตอบจากคลังความรู้
          </h2>
          <ul className="space-y-3">
            {result.articles.map((article) => (
              <li
                key={article.slug}
                className="rounded-[var(--radius-card)] border border-line bg-white p-4 text-sm"
              >
                <p className="font-bold">{article.title}</p>
                {article.faq !== null ? (
                  <>
                    <p className="mt-2 font-semibold text-ink">{article.faq.question}</p>
                    <p className="mt-1 break-words text-ink-soft">{article.faq.answer}</p>
                  </>
                ) : (
                  <p className="mt-1 break-words text-ink-soft">{article.summary}</p>
                )}
              </li>
            ))}
          </ul>
          <Link
            href="/faq"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
          >
            อ่านคำถามที่พบบ่อยทั้งหมด
          </Link>
        </section>
      )}
    </div>
  );
}

/** สิ่งที่ระบบเข้าใจจากคำค้น — แสดงทุกข้อ และสลับไปค้นแบบตรงตัวได้เสมอ */
function UnderstoodBar({ result, params }: { result: SearchResult; params: URLSearchParams }) {
  if (result.literal) {
    return (
      <p className="text-sm text-muted">
        ค้นตามตัวอักษรที่พิมพ์ (ไม่ตีความสี ไซซ์ หรืองบ) ·{" "}
        <Link
          href={withParam(params, "literal", null)}
          className="font-semibold text-brand underline"
        >
          ให้ระบบช่วยตีความ
        </Link>
      </p>
    );
  }

  if (result.understood.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">เข้าใจว่า:</span>
      {result.terms.length > 0 && (
        <span className="rounded-[var(--radius-pill)] border border-line bg-white px-3 py-1 font-semibold">
          คำค้น “{result.terms.join(" ")}”
        </span>
      )}
      {result.understood.map((part) => (
        <span
          key={part.label}
          className={cn(
            "rounded-[var(--radius-pill)] border px-3 py-1 font-semibold",
            part.available
              ? "border-brand-soft bg-lilac-50 text-brand-dark"
              : "border-warning/30 bg-warning/5 text-warning",
          )}
        >
          {part.label}
          {!part.available && " · ร้านยังไม่มี"}
        </span>
      ))}
      <Link
        href={withParam(params, "literal", "true")}
        className="flex min-h-11 items-center px-1 font-semibold text-brand underline"
      >
        ไม่ใช่ — ค้นตามตัวอักษร
      </Link>
    </div>
  );
}
