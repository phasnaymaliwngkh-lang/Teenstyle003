import { Check, X } from "lucide-react";
import Link from "next/link";

import {
  hasActiveFilters,
  readMulti,
  withClearedFilters,
  withParam,
  withToggledMulti,
} from "../lib/query";

import { cn } from "@/lib/utils";
import type { ShopFilters } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/**
 * แผงกรองสินค้า (STEP 6)
 *
 * เป็น Server Component ทั้งหมด — ทุกตัวเลือกเป็น <Link> ที่เปลี่ยน query string
 * จึงใช้งานได้แม้ JavaScript ยังโหลดไม่เสร็จ และไม่ต้องมี state ฝั่ง client
 *
 * จำนวนสินค้าข้างชื่อหมวด/แบรนด์มาจาก backend และตรงกับผลลัพธ์จริงเมื่อกดกรอง
 */
export function FilterPanel({
  filters,
  params,
}: {
  filters: ShopFilters;
  params: URLSearchParams;
}) {
  const selectedCategory = params.get("category");
  const selectedBrands = readMulti(params, "brand");
  const selectedSizes = readMulti(params, "size");
  const selectedColors = readMulti(params, "color");
  const inStockOnly = params.get("inStock") === "true";
  const onSaleOnly = params.get("onSale") === "true";

  return (
    <aside aria-label="ตัวกรองสินค้า" className="space-y-6">
      {hasActiveFilters(params) && (
        <Link
          href={withClearedFilters(params)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-danger/30 px-4 text-sm font-semibold text-danger transition hover:bg-danger/5"
        >
          <X className="size-4" aria-hidden />
          ล้างตัวกรองทั้งหมด
        </Link>
      )}

      <FilterGroup title="สถานะ">
        <ToggleRow
          href={withParam(params, "inStock", inStockOnly ? null : "true")}
          active={inStockOnly}
          label="มีของพร้อมส่ง"
        />
        <ToggleRow
          href={withParam(params, "onSale", onSaleOnly ? null : "true")}
          active={onSaleOnly}
          label="กำลังลดราคา"
        />
      </FilterGroup>

      <FilterGroup title="หมวดหมู่">
        <ToggleRow
          href={withParam(params, "category", null)}
          active={selectedCategory === null}
          label="ทั้งหมด"
        />
        {filters.categories.map((category) => (
          <ToggleRow
            key={category.slug}
            href={withParam(
              params,
              "category",
              selectedCategory === category.slug ? null : category.slug,
            )}
            active={selectedCategory === category.slug}
            label={category.name}
            count={category.productCount}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="แบรนด์">
        {filters.brands.map((brand) => (
          <ToggleRow
            key={brand.slug}
            href={withToggledMulti(params, "brand", brand.slug)}
            active={selectedBrands.includes(brand.slug)}
            label={brand.name}
            count={brand.productCount}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="ไซซ์">
        <div className="flex flex-wrap gap-2">
          {filters.sizes.map((size) => {
            const active = selectedSizes.includes(size.code);
            return (
              <Link
                key={size.code}
                href={withToggledMulti(params, "size", size.code)}
                aria-pressed={active}
                className={cn(
                  "grid min-h-11 min-w-11 place-items-center rounded-[12px] border px-3 text-sm font-semibold transition",
                  active
                    ? "border-brand bg-brand text-white"
                    : "border-line hover:border-brand-soft hover:bg-lilac-50",
                )}
              >
                {size.name}
              </Link>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup title="สี">
        <div className="flex flex-wrap gap-2">
          {filters.colors.map((color) => {
            const active = selectedColors.includes(color.slug);
            return (
              <Link
                key={color.slug}
                href={withToggledMulti(params, "color", color.slug)}
                aria-pressed={active}
                title={color.name}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-3 text-sm font-semibold transition",
                  active
                    ? "border-brand bg-lilac text-brand-dark"
                    : "border-line hover:border-brand-soft hover:bg-lilac-50",
                )}
              >
                <span
                  aria-hidden
                  className="size-4 rounded-full border border-line"
                  style={{ backgroundColor: color.hex }}
                />
                {color.name}
                {active && <Check className="size-3.5" aria-hidden />}
              </Link>
            );
          })}
        </div>
      </FilterGroup>

      <FilterGroup title="ช่วงราคา">
        <p className="mb-2 text-xs text-muted">
          สินค้าในร้านราคา {formatBaht(filters.priceRange.min)} –{" "}
          {formatBaht(filters.priceRange.max)}
        </p>
        {/* ใช้ form GET เพื่อไม่ต้องมี JS — ส่งค่าเป็น query string ตรง ๆ */}
        <form action="/shop" method="get" className="space-y-2">
          {/* คงค่า filter อื่นไว้ตอน submit */}
          {[...params.entries()]
            .filter(([key]) => key !== "minPrice" && key !== "maxPrice" && key !== "page")
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}

          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="sr-only">ราคาต่ำสุด</span>
              <input
                type="number"
                name="minPrice"
                min={0}
                max={1000000}
                inputMode="numeric"
                defaultValue={params.get("minPrice") ?? ""}
                placeholder={String(filters.priceRange.min)}
                className="min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm"
              />
            </label>
            <span aria-hidden className="text-muted">
              –
            </span>
            <label className="flex-1">
              <span className="sr-only">ราคาสูงสุด</span>
              <input
                type="number"
                name="maxPrice"
                min={0}
                max={1000000}
                inputMode="numeric"
                defaultValue={params.get("maxPrice") ?? ""}
                placeholder={String(filters.priceRange.max)}
                className="min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm"
              />
            </label>
          </div>

          <button
            type="submit"
            className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ใช้ช่วงราคานี้
          </button>
        </form>
      </FilterGroup>
    </aside>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white p-4">
      <h3 className="mb-3 text-sm font-extrabold">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function ToggleRow({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "flex min-h-11 items-center justify-between gap-2 rounded-[12px] px-3 text-sm transition",
        active ? "bg-lilac font-bold text-brand-dark" : "hover:bg-lilac-50",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded border",
            active ? "border-brand bg-brand text-white" : "border-line",
          )}
        >
          {active && <Check className="size-3" />}
        </span>
        {label}
      </span>
      {count !== undefined && <span className="text-xs text-muted">{count}</span>}
    </Link>
  );
}
