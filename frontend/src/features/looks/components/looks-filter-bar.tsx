import { Check, Search, X } from "lucide-react";
import Link from "next/link";

import { LOOK_SORT_LABEL, styleLabel } from "../lib/labels";
import {
  hasActiveFilters,
  readMulti,
  withClearedFilters,
  withParam,
  withToggledMulti,
} from "../lib/query";

import { cn } from "@/lib/utils";
import { LOOK_SORTS, type LookFilters, type LookSort } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/**
 * แถบกรอง + เรียงของหน้า /looks (STEP 7)
 *
 * เป็น Server Component ทั้งหมด — ทุกตัวเลือกเป็น <Link> ที่เปลี่ยน query string
 * ส่วนช่องค้นหาเป็น form GET จึงใช้งานได้แม้ JavaScript ยังไม่โหลด
 *
 * ตัวเลขข้างสไตล์มาจาก backend และตรงกับผลลัพธ์จริงเมื่อกดกรอง
 */
export function LooksFilterBar({
  filters,
  params,
}: {
  filters: LookFilters;
  params: URLSearchParams;
}) {
  const selectedStyles = readMulti(params, "style");
  const availableOnly = params.get("available") === "true";
  const activeSort = (params.get("sort") ?? "featured") as LookSort;
  const query = params.get("q") ?? "";

  return (
    <div className="space-y-4">
      <form action="/looks" method="get" className="flex gap-2">
        {/* คงค่า filter อื่นไว้ตอนค้นหา */}
        {[...params.entries()]
          .filter(([key]) => key !== "q" && key !== "page")
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

        <label className="flex min-h-12 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="sr-only">ค้นหาลุค</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นหาชื่อลุคหรือคำอธิบาย เช่น ไปเรียน, เดท"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>

        <button
          type="submit"
          className="btn-brand min-h-12 shrink-0 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ค้นหา
        </button>
      </form>

      <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold">สไตล์</span>

          <Link
            href={withParam(params, "style", null)}
            aria-pressed={selectedStyles.length === 0}
            className={chipClass(selectedStyles.length === 0)}
          >
            ทั้งหมด ({filters.total})
          </Link>

          {filters.styles.map((style) => {
            const active = selectedStyles.includes(style.value);
            return (
              <Link
                key={style.value}
                href={withToggledMulti(params, "style", style.value)}
                aria-pressed={active}
                className={chipClass(active)}
              >
                {active && <Check className="size-3.5" aria-hidden />}
                {styleLabel(style.value)} ({style.lookCount})
              </Link>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs font-extrabold">เงื่อนไข</span>

          <Link
            href={withParam(params, "available", availableOnly ? null : "true")}
            aria-pressed={availableOnly}
            className={chipClass(availableOnly)}
          >
            {availableOnly && <Check className="size-3.5" aria-hidden />}
            ซื้อครบชุดได้ ({filters.availableCount})
          </Link>

          <span className="text-xs text-muted">
            ราคารวมของลุคในร้าน {formatBaht(filters.priceRange.min)} –{" "}
            {formatBaht(filters.priceRange.max)}
          </span>

          {hasActiveFilters(params) && (
            <Link
              href={withClearedFilters(params)}
              className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border border-danger/30 px-3 text-xs font-semibold text-danger transition hover:bg-danger/5"
            >
              <X className="size-3.5" aria-hidden />
              ล้างตัวกรอง
            </Link>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs font-extrabold">เรียงตาม</span>
          {LOOK_SORTS.map((sort) => (
            <Link
              key={sort}
              href={withParam(params, "sort", sort)}
              aria-current={activeSort === sort ? "true" : undefined}
              className={chipClass(activeSort === sort)}
            >
              {LOOK_SORT_LABEL[sort]}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
  );
}
