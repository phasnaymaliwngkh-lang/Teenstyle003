import { Search } from "lucide-react";
import Link from "next/link";

import { withParam } from "../lib/query";

import { cn } from "@/lib/utils";
import { SHOP_SORTS, type ShopSort } from "@/types/catalog";

const SORT_LABEL: Record<ShopSort, string> = {
  newest: "ใหม่สุด",
  "price-asc": "ราคาต่ำ → สูง",
  "price-desc": "ราคาสูง → ต่ำ",
  discount: "ส่วนลดมากสุด",
  popular: "นิยมสุด",
  bestselling: "ขายดีสุด",
};

/**
 * แถบเครื่องมือของหน้า /shop — ช่องค้นหา + ตัวเรียงลำดับ (STEP 6)
 *
 * ทั้งหมดเป็น Server Component: ค้นหาใช้ form GET, เรียงลำดับใช้ <Link>
 * จึงทำงานได้โดยไม่ต้องมี JavaScript
 */
export function ShopToolbar({ params, total }: { params: URLSearchParams; total: number }) {
  const activeSort = (params.get("sort") ?? "newest") as ShopSort;
  const query = params.get("q") ?? "";

  return (
    <div className="space-y-4">
      <form action="/shop" method="get" className="flex flex-wrap gap-2">
        {/* คงค่า filter อื่นไว้ตอนค้นหา */}
        {[...params.entries()]
          .filter(([key]) => key !== "q" && key !== "page")
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="sr-only">ค้นหาสินค้า</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นหาชื่อสินค้า, SKU หรือคำค้น เช่น oversize"
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          พบ <strong className="text-ink">{total}</strong> รายการ
          {query && (
            <>
              {" "}
              จากคำค้น <strong className="text-ink">“{query}”</strong>
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">เรียงตาม</span>
          {SHOP_SORTS.map((sort) => (
            <Link
              key={sort}
              href={withParam(params, "sort", sort)}
              aria-current={activeSort === sort ? "true" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition",
                activeSort === sort
                  ? "border-brand bg-brand text-white"
                  : "border-line hover:border-brand-soft hover:bg-lilac-50",
              )}
            >
              {SORT_LABEL[sort]}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
