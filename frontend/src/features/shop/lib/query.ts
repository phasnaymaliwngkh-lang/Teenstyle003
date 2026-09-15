import {
  createQueryHelpers,
  readMulti,
  toSearchParams,
  type RawSearchParams,
} from "@/lib/query-params";

/**
 * query string ของหน้า /shop (STEP 6)
 * ตรรกะจริงอยู่ที่ [lib/query-params.ts](../../../lib/query-params.ts) — ไฟล์นี้แค่ผูกกับเส้นทาง /shop
 */

/** filter ที่รับหลายค่า (เก็บเป็น CSV ใน URL) */
export const MULTI_KEYS = ["brand", "size", "color"] as const;

/** คีย์ที่ถือว่าเป็น filter (ใช้ตัดสินว่ามีตัวกรองทำงานอยู่ไหม) */
const SHOP_FILTER_KEYS = [
  "category",
  "brand",
  "size",
  "color",
  "minPrice",
  "maxPrice",
  "inStock",
  "onSale",
] as const;

const helpers = createQueryHelpers("/shop", SHOP_FILTER_KEYS);

export const { withParam, withToggledMulti, withClearedFilters, hasActiveFilters } = helpers;
export { readMulti, toSearchParams };
export type { RawSearchParams };
