import {
  createQueryHelpers,
  readMulti,
  toSearchParams,
  type RawSearchParams,
} from "@/lib/query-params";

/**
 * query string ของหน้า /looks (STEP 7)
 * ใช้ตรรกะเดียวกับ /shop แต่ผูกกับเส้นทาง /looks
 */

const LOOK_FILTER_KEYS = ["style", "available", "minPrice", "maxPrice"] as const;

const helpers = createQueryHelpers("/looks", LOOK_FILTER_KEYS);

export const { withParam, withToggledMulti, withClearedFilters, hasActiveFilters } = helpers;
export { readMulti, toSearchParams };
export type { RawSearchParams };
