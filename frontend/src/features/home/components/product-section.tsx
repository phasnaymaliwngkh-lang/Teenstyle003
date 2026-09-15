import { ProductCard } from "@/features/products/components/product-card";
import { SectionEmpty, SectionError, SectionHeader } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { fetchProducts } from "@/services/catalog.service";
import type { ProductSort } from "@/types/catalog";

/**
 * Section แสดงรายการสินค้าบนหน้าแรก — ใช้ซ้ำได้ทุกชุด (New Arrivals, Flash Sale, ฯลฯ)
 *
 * เป็น Server Component: ดึงข้อมูลฝั่ง server แล้วส่ง HTML ที่มีข้อมูลมาเลย
 * ครอบ error ไว้เองเพื่อให้ section หนึ่งล้มไม่ทำให้ทั้งหน้าพัง
 * (Loading state มาจาก <Suspense> ที่ห่อ component นี้ในหน้า page.tsx)
 */
export async function ProductSection({
  eyebrow,
  title,
  subtitle,
  sort,
  limit = 4,
  emptyMessage,
  emptyHint,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  sort: ProductSort;
  limit?: number;
  emptyMessage: string;
  emptyHint?: string;
  action?: { label: string; href: string };
}) {
  let items: Awaited<ReturnType<typeof fetchProducts>>["items"] | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await fetchProducts(sort, limit);
    items = result.items;
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก";
  }

  return (
    <section aria-labelledby={`section-${sort}`}>
      <div id={`section-${sort}`}>
        <SectionHeader
          {...(eyebrow ? { eyebrow } : {})}
          title={title}
          {...(subtitle ? { subtitle } : {})}
          {...(action ? { action } : {})}
        />
      </div>

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : items && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <SectionEmpty message={emptyMessage} {...(emptyHint ? { hint: emptyHint } : {})} />
      )}
    </section>
  );
}
