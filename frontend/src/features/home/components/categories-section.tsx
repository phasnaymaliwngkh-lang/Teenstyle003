import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { SectionEmpty, SectionError, SectionHeader } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { fetchCategories } from "@/services/catalog.service";
import type { CategoryCard } from "@/types/catalog";

/** หมวดหมู่สินค้า — จำนวนสินค้าในแต่ละหมวดมาจากฐานข้อมูลจริง */
export async function CategoriesSection() {
  let items: CategoryCard[] | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await fetchCategories();
    items = result.items;
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก";
  }

  return (
    <section aria-labelledby="section-categories">
      <div id="section-categories">
        <SectionHeader
          eyebrow="Categories"
          title="เลือกตามหมวดหมู่"
          subtitle="ตัวเลขคือจำนวนสินค้าที่ขายอยู่จริงในแต่ละหมวด (รวมหมวดย่อย)"
        />
      </div>

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : items && items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((category) => (
            <Link
              key={category.id}
              href={`/shop?category=${category.slug}`}
              className="group flex flex-col rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:border-brand-soft hover:shadow-[var(--shadow-lift)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-extrabold">{category.name}</h3>
                <span className="shrink-0 rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-xs font-bold text-brand-dark">
                  {category.productCount} ชิ้น
                </span>
              </div>

              {category.description && (
                <p className="mt-2 text-sm text-muted">{category.description}</p>
              )}

              {category.children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {category.children.map((child) => (
                    <li
                      key={child.slug}
                      className="rounded-[var(--radius-pill)] border border-line bg-lilac-50 px-2.5 py-0.5 text-xs text-muted"
                    >
                      {child.name}
                    </li>
                  ))}
                </ul>
              )}

              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand transition group-hover:gap-3">
                ดูสินค้า
                <ArrowRight className="size-4" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <SectionEmpty
          message="ยังไม่มีหมวดหมู่สินค้า"
          hint="เพิ่มหมวดหมู่ได้ในระบบหลังบ้าน หรือรัน npm run db:seed เพื่อใส่ข้อมูลตั้งต้น"
        />
      )}
    </section>
  );
}
