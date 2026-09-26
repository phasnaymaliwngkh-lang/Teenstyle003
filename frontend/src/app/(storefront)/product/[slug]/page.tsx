import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  SectionEmpty,
  SectionError,
  SectionHeader,
  SectionSkeleton,
} from "@/components/shared/section";
import { ProductCard } from "@/features/products/components/product-card";
import { ProductGallery } from "@/features/products/components/product-gallery";
import { VariantPicker } from "@/features/products/components/variant-picker";
import { ProductRatingBadge } from "@/features/reviews/components/product-rating-badge";
import { ReviewSection } from "@/features/reviews/components/review-section";
import { WishlistHeart } from "@/features/wishlist/components/wishlist-heart";
import { JsonLd } from "@/components/shared/json-ld";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo";
import { fetchProductDetail, searchShopProducts } from "@/services/catalog.service";
import { fetchProductReviewsOnServer } from "@/services/review.server";
import { fetchWishlistedIdsOnServer } from "@/services/wishlist.server";
import type { ProductDetail } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

type PageProps = {
  params: Promise<{ slug: string }>;
  /** ส่วนรีวิวใช้ `reviewSort` / `reviewRating` / `reviewPage` (STEP 23) */
  searchParams: Promise<RawSearchParams>;
};

/**
 * คะแนนรีวิวสำหรับ structured data (STEP 33)
 *
 * ใช้ cache key เดียวกับ `ProductRatingBadge` (limit=1, ไม่ล็อกอิน) จึงไม่เพิ่มคำขอจริง
 * อ่านไม่ได้ → คืน null แล้ว `productJsonLd` จะ **ไม่ประกาศ aggregateRating เลย**
 * (กฎ STEP 23 ข้อ 4: 0 ดาวหมายถึง "แย่มาก" ไม่ใช่ "ยังไม่มีข้อมูล")
 */
async function loadRatingForJsonLd(
  slug: string,
): Promise<{ average: number; total: number } | null> {
  try {
    const result = await fetchProductReviewsOnServer(
      slug,
      new URLSearchParams({ limit: "1" }),
      false,
    );
    return result.summary.total > 0 ? result.summary : null;
  } catch {
    return null;
  }
}

type LoadResult =
  | { kind: "found"; product: ProductDetail }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * โหลดสินค้าหนึ่งชิ้น แล้วแยกให้ชัดว่า "ไม่มีสินค้านี้" ต่างจาก "โหลดไม่สำเร็จ"
 *
 * 404 = ไม่มีในฐานข้อมูล, 422 = slug ผิดรูปแบบ (จึงไม่มีทางมีสินค้านี้) → ทั้งคู่คือ not found
 * ที่เหลือ (backend ล่ม / timeout / 500) = error state ที่ลองใหม่ได้
 */
async function loadProduct(slug: string): Promise<LoadResult> {
  try {
    return { kind: "found", product: await fetchProductDetail(slug) };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      return { kind: "missing" };
    }

    return {
      kind: "error",
      message: error instanceof ApiClientError ? error.message : "โหลดข้อมูลสินค้าไม่สำเร็จ",
    };
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadProduct(slug);

  if (loaded.kind !== "found") {
    // ไม่ throw ที่นี่ — ให้ตัว page เป็นผู้ตัดสิน 404/error เพื่อให้ HTTP status ถูกต้อง
    return { title: loaded.kind === "missing" ? "ไม่พบสินค้า" : "รายละเอียดสินค้า" };
  }

  const { product } = loaded;

  /*
   * description ของสินค้าส่วนใหญ่สั้นกว่า 50 ตัวอักษร (shortDescription เขียนไว้สำหรับการ์ดสินค้า)
   * ซึ่งสั้นเกินกว่าที่ SERP จะอธิบายอะไรได้ → เติมบริบทที่ **เป็นความจริงและมาจากฐานข้อมูล**
   * (หมวดหมู่ · แบรนด์) ต่อท้าย ไม่ใช่แต่งคำโฆษณาเพิ่ม (STEP 33)
   */
  const summary = product.shortDescription ?? product.description;
  const context = [product.brand?.name, product.category.name].filter(Boolean).join(" · ");
  const description = `${summary} — ${context} จาก TEENSTYLE AI ราคาและสต็อกอัปเดตจากคลังจริง`;

  return {
    title: product.name,
    description: description.slice(0, 160),
    /*
     * canonical ต้องไม่มี query ของส่วนรีวิว (reviewSort/reviewRating/reviewPage) ติดไปด้วย
     * ไม่งั้นการเปลี่ยนหน้ารีวิวจะกลายเป็นสินค้าชิ้นใหม่ในสายตา Google ทุกครั้ง (STEP 33)
     */
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      // og:type = "website" ตามค่าที่ root ตั้งไว้ไม่ผิด แต่หน้าสินค้าควรบอกว่าเป็นสินค้า
      type: "article",
      title: product.name,
      description,
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
  };
}

/**
 * หน้ารายละเอียดสินค้า /product/[slug] (STEP 6)
 *
 * ข้อมูลทั้งหมด — ราคา ส่วนลด สต็อก ตัวเลือก — มาจาก backend/ฐานข้อมูลจริง
 * ไม่มีการคำนวณหรือแต่งข้อมูลฝั่ง client
 *
 * ⚠️ ตั้งใจ await ข้อมูลหลักที่ระดับ page (ไม่ห่อ <Suspense> และไม่มี loading.tsx)
 *    เพราะถ้า stream ออกไปก่อน Next จะส่ง HTTP 200 แล้วเปลี่ยนเป็น 404 ไม่ได้อีก
 *    (ทดลองยืนยันแล้ว: มี loading.tsx → 200, ไม่มี → 404 ตามจริง)
 *    ส่วนที่เหลือ (สินค้าที่เกี่ยวข้อง) ยัง stream พร้อม skeleton ตามปกติ
 */
export default async function ProductPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const loaded = await loadProduct(slug);

  if (loaded.kind === "missing") {
    notFound();
  }

  /**
   * สถานะ "ถูกใจแล้วหรือยัง" หามาที่ server เพื่อให้หัวใจถูกต้องตั้งแต่เฟรมแรก
   * (ยังไม่ล็อกอิน = เซ็ตว่าง ไม่ยิง API และหน้าสินค้ายังเปิดดูได้ตามปกติ)
   */
  const session = await getSession();
  const wishlisted =
    loaded.kind === "found" && session
      ? await fetchWishlistedIdsOnServer([loaded.product.id])
      : new Set<string>();

  const reviewParams = toSearchParams(await searchParams);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
      {loaded.kind === "error" ? (
        <SectionError message={loaded.message} />
      ) : (
        <>
          <JsonLd
            data={[
              productJsonLd({
                name: loaded.product.name,
                slug: loaded.product.slug,
                sku: loaded.product.sku,
                description: loaded.product.shortDescription ?? loaded.product.description,
                images: loaded.product.images.map((image) => image.url),
                // ราคาที่ประกาศต้องเป็นราคาที่เก็บเงินจริง (salePrice ?? price) — backend คิดมาให้แล้ว
                price: loaded.product.finalPrice,
                stockStatus: loaded.product.stockStatus,
                brandName: loaded.product.brand?.name ?? null,
                categoryName: loaded.product.category.name,
                rating: await loadRatingForJsonLd(loaded.product.slug),
              }),
              breadcrumbJsonLd([
                { name: "หน้าแรก", path: "/" },
                { name: "เลือกซื้อสินค้า", path: "/shop" },
                {
                  name: loaded.product.category.name,
                  path: `/shop?category=${loaded.product.category.slug}`,
                },
                { name: loaded.product.name, path: `/product/${loaded.product.slug}` },
              ]),
            ]}
          />

          <ProductDetailSection
            product={loaded.product}
            isSignedIn={session !== null}
            isWishlisted={wishlisted.has(loaded.product.id)}
          />

          {/* รีวิว (STEP 23) — stream แยก: โหลดช้าหรือพังต้องไม่ทำให้ราคา/ปุ่มซื้อหาย */}
          <div className="mt-14">
            <Suspense fallback={<ReviewsSkeleton />}>
              <ReviewSection
                slug={loaded.product.slug}
                productId={loaded.product.id}
                isSignedIn={session !== null}
                params={reviewParams}
              />
            </Suspense>
          </div>

          <div className="mt-14">
            <Suspense fallback={<RelatedSkeleton />}>
              <RelatedSection
                // ใช้หมวดแม่ถ้ามี เพราะหมวดย่อย (เช่น "เสื้อยืด") อาจมีสินค้าชิ้นเดียว
                categorySlug={loaded.product.category.parent?.slug ?? loaded.product.category.slug}
                excludeId={loaded.product.id}
              />
            </Suspense>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * สินค้าที่เกี่ยวข้อง — หมวดเดียวกัน เรียงตามความนิยม
 * แยกเป็น section ที่ stream เอง: ช้าหรือพังก็ไม่กระทบข้อมูลสินค้าหลัก
 */
async function RelatedSection({
  categorySlug,
  excludeId,
}: {
  categorySlug: string;
  excludeId: string;
}) {
  let items: Awaited<ReturnType<typeof searchShopProducts>>["items"] = [];
  let errorMessage: string | null = null;

  try {
    const result = await searchShopProducts(
      new URLSearchParams({ category: categorySlug, sort: "popular", limit: "5" }),
    );
    // ตัดตัวมันเองออก แล้วเหลือไว้ 4 ชิ้น
    items = result.items.filter((item) => item.id !== excludeId).slice(0, 4);
  } catch (error) {
    errorMessage =
      error instanceof ApiClientError ? error.message : "โหลดสินค้าที่เกี่ยวข้องไม่สำเร็จ";
  }

  return (
    <section>
      <SectionHeader
        title="สินค้าที่เกี่ยวข้อง"
        subtitle="จากหมวดเดียวกัน เรียงตามความนิยม"
        action={{ label: "ดูทั้งหมดในหมวดนี้", href: `/shop?category=${categorySlug}` }}
      />

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : items.length === 0 ? (
        <SectionEmpty
          message="ยังไม่มีสินค้าอื่นในหมวดนี้"
          hint="ดูสินค้าทั้งหมดในร้านได้ที่หน้า Shop"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewsSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite">
      <h2 className="text-2xl sm:text-3xl">รีวิวจากคนที่ซื้อจริง</h2>
      <p className="mt-2 text-sm text-muted">กำลังโหลดรีวิว…</p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[320px_1fr]">
        <div className="h-52 rounded-[var(--radius-card)] bg-lilac-50" aria-hidden />
        <div className="space-y-4" aria-hidden>
          <div className="h-32 rounded-[var(--radius-card)] bg-lilac-50" />
          <div className="h-32 rounded-[var(--radius-card)] bg-lilac-50" />
        </div>
      </div>
    </section>
  );
}

function RelatedSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl">สินค้าที่เกี่ยวข้อง</h2>
        <p className="mt-2 text-sm text-muted">กำลังโหลดข้อมูล…</p>
      </div>
      <SectionSkeleton count={4} />
    </section>
  );
}

function ProductDetailSection({
  product,
  isSignedIn,
  isWishlisted,
}: {
  product: ProductDetail;
  isSignedIn: boolean;
  isWishlisted: boolean;
}) {
  const category = product.category;

  return (
    <div className="space-y-10">
      <nav aria-label="เส้นทางนำทาง" className="flex flex-wrap items-center gap-1 text-xs">
        <Crumb href="/">หน้าแรก</Crumb>
        <Sep />
        <Crumb href="/shop">สินค้าทั้งหมด</Crumb>
        {category.parent && (
          <>
            <Sep />
            <Crumb href={`/shop?category=${category.parent.slug}`}>{category.parent.name}</Crumb>
          </>
        )}
        <Sep />
        <Crumb href={`/shop?category=${category.slug}`}>{category.name}</Crumb>
        <Sep />
        <span aria-current="page" className="font-bold text-ink">
          {product.name}
        </span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="min-w-0 space-y-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {product.brand && (
                <Link
                  href={`/shop?brand=${product.brand.slug}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] bg-lilac px-3.5 text-[11px] font-bold tracking-wider text-brand-dark uppercase transition hover:bg-brand-soft/30"
                >
                  {product.brand.name}
                </Link>
              )}
              <span className="text-xs text-muted">SKU {product.sku}</span>
            </div>

            <h1 className="text-2xl leading-tight sm:text-3xl lg:text-4xl">{product.name}</h1>

            {/* คะแนนรีวิว (STEP 23) — โหลดเองใน Suspense เพื่อไม่ให้ถ่วงราคาและปุ่มซื้อ */}
            <Suspense fallback={<span className="block h-4" aria-hidden />}>
              <ProductRatingBadge slug={product.slug} />
            </Suspense>

            {product.shortDescription && (
              <p className="text-sm text-muted">{product.shortDescription}</p>
            )}

            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-extrabold text-brand-dark">
                {formatBaht(product.finalPrice)}
              </span>
              {product.salePrice !== null && (
                <>
                  <s className="text-base text-muted-light">{formatBaht(product.price)}</s>
                  {product.discountPercent !== null && (
                    <span className="rounded-[var(--radius-pill)] bg-danger px-2.5 py-1 text-xs font-bold text-white">
                      -{product.discountPercent}%
                    </span>
                  )}
                </>
              )}
            </div>

            <p className="text-sm font-semibold text-muted">
              สถานะสินค้ารวมทุกตัวเลือก:{" "}
              <span
                className={
                  product.stockStatus === "IN_STOCK"
                    ? "text-success"
                    : product.stockStatus === "LOW_STOCK"
                      ? "text-warning"
                      : "text-muted-light"
                }
              >
                {STOCK_LABEL[product.stockStatus]}
              </span>
              {product.totalAvailable > 0 && ` · รวม ${product.totalAvailable} ชิ้น`}
            </p>
          </header>

          {product.variants.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-4 text-sm text-muted">
              สินค้านี้ยังไม่มีตัวเลือกให้สั่งซื้อ
            </p>
          ) : (
            <VariantPicker product={product} />
          )}

          {/* เก็บไว้ดูทีหลัง (STEP 22) — กดได้แม้สินค้าหมด เพราะจะได้รู้เมื่อของกลับมา/ราคาลด */}
          <WishlistHeart
            productId={product.id}
            productName={product.name}
            initialWishlisted={isWishlisted}
            isSignedIn={isSignedIn}
          />

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/shop?q=${encodeURIComponent(tag)}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-3.5 text-xs font-semibold text-muted transition hover:border-brand-soft hover:bg-lilac-50"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="max-w-3xl">
        <h2 className="text-xl">รายละเอียดสินค้า</h2>
        {/* ข้อความจากฐานข้อมูล — render เป็น text ล้วน ไม่ใช่ HTML เพื่อกัน XSS */}
        <div className="mt-3 space-y-3 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
          {product.description}
        </div>
      </section>

      <section>
        <h2 className="text-xl">ตัวเลือกทั้งหมดและจำนวนคงเหลือ</h2>
        <p className="mt-1 text-sm text-muted">
          จำนวนนี้อ่านจากคลังจริง (จำนวนในคลัง − จำนวนที่ถูกจองไว้)
          และจะตรวจซ้ำที่เซิร์ฟเวอร์อีกครั้ง ก่อนเพิ่มลงตะกร้า
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted uppercase">
                <th scope="col" className="py-2 pr-3 font-bold">
                  SKU
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  สี
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  ไซซ์
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  ราคา
                </th>
                <th scope="col" className="py-2 font-bold">
                  คงเหลือ
                </th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant) => (
                <tr key={variant.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 font-mono text-xs">{variant.sku}</td>
                  <td className="py-2 pr-3">{variant.color?.name ?? "—"}</td>
                  <td className="py-2 pr-3">{variant.size?.name ?? "—"}</td>
                  <td className="py-2 pr-3 font-semibold">{formatBaht(variant.finalPrice)}</td>
                  <td className="py-2">
                    {variant.available > 0 ? (
                      <span className="font-semibold">{variant.available}</span>
                    ) : (
                      <span className="text-muted-light">หมด</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Crumb({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-muted transition hover:text-brand">
      {children}
    </Link>
  );
}

function Sep() {
  return <ChevronRight className="size-3 shrink-0 text-muted-light" aria-hidden />;
}
