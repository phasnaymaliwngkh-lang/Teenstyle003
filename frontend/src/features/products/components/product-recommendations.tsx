import Link from "next/link";

import {
  SectionEmpty,
  SectionError,
  SectionHeader,
  SectionSkeleton,
} from "@/components/shared/section";
import { ProductCard } from "@/features/products/components/product-card";
import { ApiClientError } from "@/lib/api";
import { fetchProductRecommendations } from "@/services/recommendation.server";
import type { ProductRecommendations as ProductRecommendationsData } from "@/types/recommendation";

/**
 * ส่วนแนะนำใต้หน้าสินค้า (STEP 46) — แทน "สินค้าที่เกี่ยวข้อง" เดิมที่เป็นแค่ยอดนิยมในหมวดเดียวกัน
 *
 * 1. **ซื้อด้วยกันบ่อย** — จากคำสั่งซื้อจริงที่ร้านได้เงินแล้วเท่านั้น
 *    ยังไม่มีใครซื้อคู่กัน = **ไม่แสดงหัวข้อนี้เลย** (ไม่เอาของหมวดเดียวกันมาเติมแล้วเรียกว่า "ซื้อด้วยกัน")
 * 2. **แมตช์ในลุค** — ลุคที่ร้านจัดชิ้นนี้ไว้จริง ไม่มีลุค = ไม่แสดง
 * 3. **สินค้าคล้ายกัน** — หมวด/หมวดแม่ · สไตล์ร่วม · ราคาใกล้กัน ไม่มี = บอกว่าไม่มี
 *
 * stream แยกจากข้อมูลสินค้าหลัก: ช้าหรือพังต้องไม่ทำให้ราคา/ปุ่มซื้อหาย (กฎ STEP 5 ข้อ 1)
 */
export async function ProductRecommendations({
  slug,
  categorySlug,
}: {
  slug: string;
  /** หมวดสำหรับปุ่ม "ดูทั้งหมดในหมวดนี้" (ใช้หมวดแม่ถ้ามี) */
  categorySlug: string;
}) {
  let data: ProductRecommendationsData | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchProductRecommendations(slug);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดสินค้าแนะนำไม่สำเร็จ";
  }

  if (errorMessage !== null || data === null) {
    return (
      <section aria-labelledby="similar-heading">
        <h2 id="similar-heading" className="mb-6 text-2xl sm:text-3xl">
          สินค้าคล้ายกัน
        </h2>
        <SectionError message={errorMessage ?? "โหลดสินค้าแนะนำไม่สำเร็จ"} />
      </section>
    );
  }

  return (
    <div className="space-y-14">
      {data.boughtTogether.length > 0 && (
        <section aria-labelledby="bought-together-heading">
          <div id="bought-together-heading">
            <SectionHeader
              title="ซื้อด้วยกันบ่อย"
              subtitle="จากคำสั่งซื้อจริงของลูกค้าคนอื่นที่ชำระเงินแล้ว — ใต้การ์ดบอกจำนวนคำสั่งซื้อที่มีทั้งสองชิ้น"
            />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.boughtTogether.map((item) => (
              <ProductCard key={item.product.id} product={item.product} note={item.reason} />
            ))}
          </div>
        </section>
      )}

      {data.looks.length > 0 && (
        <section aria-labelledby="in-looks-heading">
          <div id="in-looks-heading">
            <SectionHeader
              title="แมตช์ในลุค"
              subtitle="ลุคที่ร้านจัดชิ้นนี้ไว้ พร้อมชิ้นอื่นในลุคที่ยังพร้อมขาย"
            />
          </div>
          <div className="space-y-8">
            {data.looks.map((look) => (
              <div key={look.slug}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="min-w-0 text-lg font-bold">{look.name}</h3>
                  <Link
                    href={`/looks/${look.slug}`}
                    className="flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                  >
                    ดูทั้งลุค
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {look.items.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="similar-heading">
        <div id="similar-heading">
          <SectionHeader
            title="สินค้าคล้ายกัน"
            subtitle="หมวดเดียวกันหรือมีสไตล์ร่วมกัน เรียงจากความใกล้เคียงและราคาที่ใกล้กัน"
            action={{ label: "ดูทั้งหมดในหมวดนี้", href: `/shop?category=${categorySlug}` }}
          />
        </div>

        {data.similar.length === 0 ? (
          <SectionEmpty
            message="ยังไม่มีสินค้าที่คล้ายกันและพร้อมขาย"
            hint="ดูสินค้าทั้งหมดในร้านได้ที่หน้า Shop"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.similar.map((item) => (
              <ProductCard key={item.product.id} product={item.product} note={item.reason} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ProductRecommendationsSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl">สินค้าคล้ายกัน</h2>
        <p className="mt-2 text-sm text-muted">กำลังโหลดข้อมูล…</p>
      </div>
      <SectionSkeleton count={4} />
    </section>
  );
}
