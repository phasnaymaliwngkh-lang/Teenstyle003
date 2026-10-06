import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";

/**
 * query string ของหน้า /search (STEP 45)
 * ตรรกะจริงอยู่ที่ [lib/query-params.ts](../../../lib/query-params.ts) — ไฟล์นี้แค่ผูกกับเส้นทาง /search
 */
const helpers = createQueryHelpers("/search", ["q", "literal", "sort"]);

export const { withParam } = helpers;
export { toSearchParams };
export type { RawSearchParams };

/** ลิงก์ค้นคำใหม่ — เริ่มจากศูนย์ (ไม่พกการเรียง/ตรงตัวของคำเดิมไปด้วย) */
export function searchHref(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}

/** ลิงก์ไปหน้า /shop พร้อมเงื่อนไขชุดเดียวกับที่ค้นได้ — กรองต่อด้วยแผงตัวกรองเต็ม */
export function shopHref(shopQuery: Record<string, string>): string {
  const qs = new URLSearchParams(shopQuery).toString();

  return qs ? `/shop?${qs}` : "/shop";
}
