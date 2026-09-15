/**
 * เครื่องมือจัดการ query string ของหน้ารายการ (STEP 6 — /shop · STEP 7 — /looks)
 *
 * เก็บ filter ทั้งหมดไว้ใน URL ไม่ใช่ใน state ของ client เพราะ
 *   1. แชร์ลิงก์แล้วเห็นผลเดียวกัน · กด back/forward ได้ถูกต้อง
 *   2. หน้า render ฝั่ง server ได้เลย ไม่ต้องรอ JS
 *   3. ดีต่อ SEO (STEP 33)
 *
 * ทุกฟังก์ชันคืน string ที่เอาไปใส่ href ของ <Link> ได้ตรง ๆ
 * หน้าไหนจะใช้ ให้สร้างชุดของตัวเองด้วย `createQueryHelpers(basePath, filterKeys)`
 * เพื่อไม่ต้องเขียนตรรกะเดิมซ้ำ (เคยซ้ำอยู่ในโฟลเดอร์ shop)
 */

/** ค่าที่รับได้จาก searchParams ของ Next (อาจเป็น array ถ้าคีย์ซ้ำกัน) */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export function toSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    // ถ้ามีคีย์ซ้ำใน URL ใช้ค่าแรกพอ เพื่อให้พฤติกรรมคาดเดาได้
    params.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }

  return params;
}

/** อ่านค่าหลายค่าจาก CSV เช่น "brand-a,brand-b" */
export function readMulti(params: URLSearchParams, key: string): string[] {
  const value = params.get(key);
  if (!value) return [];

  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export interface QueryHelpers {
  /** ตั้งค่าเดี่ยว — ส่ง null เพื่อลบออก */
  withParam: (params: URLSearchParams, key: string, value: string | number | null) => string;
  /** สลับค่าในกลุ่มที่เลือกได้หลายอัน (เก็บเป็น CSV) */
  withToggledMulti: (params: URLSearchParams, key: string, value: string) => string;
  /** ล้าง filter ทั้งหมด (เก็บคำค้นและการเรียงไว้) */
  withClearedFilters: (params: URLSearchParams) => string;
  /** มี filter ใดถูกใช้อยู่ไหม (ไม่นับ q / sort / page) */
  hasActiveFilters: (params: URLSearchParams) => boolean;
}

export function createQueryHelpers(basePath: string, filterKeys: readonly string[]): QueryHelpers {
  function buildHref(params: URLSearchParams): string {
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return {
    withParam(params, key, value) {
      const next = new URLSearchParams(params);

      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));

      // เปลี่ยน filter แล้วต้องกลับไปหน้า 1 ไม่งั้นอาจเห็นหน้าว่าง
      if (key !== "page") next.delete("page");

      return buildHref(next);
    },

    withToggledMulti(params, key, value) {
      const current = readMulti(params, key);
      const next = new URLSearchParams(params);

      const updated = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];

      if (updated.length === 0) next.delete(key);
      else next.set(key, updated.join(","));

      next.delete("page");

      return buildHref(next);
    },

    withClearedFilters(params) {
      const next = new URLSearchParams();
      const q = params.get("q");
      const sort = params.get("sort");

      if (q) next.set("q", q);
      if (sort) next.set("sort", sort);

      return buildHref(next);
    },

    hasActiveFilters(params) {
      return filterKeys.some((key) => {
        const value = params.get(key);
        return value !== null && value !== "";
      });
    },
  };
}
