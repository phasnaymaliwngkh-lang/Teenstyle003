import { apiFetch } from "@/lib/api";
import type {
  AvailabilityResult,
  CategoryCard,
  ListResult,
  LookAvailabilityResult,
  LookCard,
  LookDetail,
  LookFilters,
  LookResult,
  ProductDetail,
  ProductListResult,
  ProductSort,
  ShopFilters,
  ShopResult,
} from "@/types/catalog";

/**
 * ชั้นเดียวที่เรียก API ของหน้าร้าน — คอมโพเนนต์ห้ามเรียก fetch เอง
 *
 * ใช้ revalidate 60 วินาที: ข้อมูลสินค้าไม่ได้เปลี่ยนทุกวินาที
 * จึงให้ Next cache ผลลัพธ์ไว้ ลดภาระฐานข้อมูล (STEP 34 — Performance)
 * ถ้าต้องการข้อมูลสด ๆ ทันที (เช่นหน้า admin) ให้ส่ง cache: "no-store" เข้ามา
 */
const REVALIDATE_SECONDS = 60;

export function fetchProducts(sort: ProductSort, limit: number): Promise<ProductListResult> {
  return apiFetch<ProductListResult>(`/api/products?sort=${sort}&limit=${limit}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["products"] },
  });
}

export function fetchCategories(): Promise<ListResult<CategoryCard>> {
  return apiFetch<ListResult<CategoryCard>>("/api/categories", {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["categories"] },
  });
}

export function fetchLooks(limit: number): Promise<ListResult<LookCard>> {
  return apiFetch<ListResult<LookCard>>(`/api/looks?limit=${limit}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["looks"] },
  });
}

/* ─── STEP 6: /shop และ /product/[slug] ───────────────────────────────────── */

/**
 * ค้นหาสินค้าสำหรับหน้า /shop
 * ส่ง query string ที่ผู้ใช้เลือกไปให้ backend ตรวจและกรอง (ไม่กรองฝั่ง client)
 */
export function searchShopProducts(searchParams: URLSearchParams): Promise<ShopResult> {
  const qs = searchParams.toString();

  return apiFetch<ShopResult>(`/api/products/search${qs ? `?${qs}` : ""}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["products"] },
  });
}

export function fetchShopFilters(): Promise<ShopFilters> {
  return apiFetch<ShopFilters>("/api/products/filters", {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["products", "categories"] },
  });
}

export function fetchProductDetail(slug: string): Promise<ProductDetail> {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(slug)}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["products", `product:${slug}`] },
  });
}

/* ─── STEP 7: /looks ──────────────────────────────────────────────────────── */

/** ค้นหา/กรองลุคสำหรับหน้า /looks — backend เป็นผู้กรองและเรียงจริง */
export function searchLooks(searchParams: URLSearchParams): Promise<LookResult> {
  const qs = searchParams.toString();

  return apiFetch<LookResult>(`/api/looks/search${qs ? `?${qs}` : ""}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["looks"] },
  });
}

export function fetchLookFilters(): Promise<LookFilters> {
  return apiFetch<LookFilters>("/api/looks/filters", {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["looks"] },
  });
}

/* ─── STEP 8: /looks/[slug] ───────────────────────────────────────────────── */

export function fetchLookDetail(slug: string): Promise<LookDetail> {
  return apiFetch<LookDetail>(`/api/looks/${encodeURIComponent(slug)}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["looks", `look:${slug}`] },
  });
}

/**
 * ตรวจว่าซื้อทั้งชุดได้จริงก่อนเพิ่มลงตะกร้า — เรียกจาก client ตอนกดปุ่ม
 *
 * ส่งไปแค่ variantId + จำนวน · ราคาและสต็อกมาจาก server เท่านั้น
 * `cache: "no-store"` เพราะสต็อกเปลี่ยนได้ทุกวินาที ห้ามใช้คำตอบเก่า
 */
export function checkLookAvailability(
  slug: string,
  selections: { variantId: string; quantity: number }[],
): Promise<LookAvailabilityResult> {
  return apiFetch<LookAvailabilityResult>(`/api/looks/${encodeURIComponent(slug)}/availability`, {
    method: "POST",
    json: { selections },
    cache: "no-store",
  });
}

/**
 * ตรวจว่าซื้อได้จริงก่อนเพิ่มลงตะกร้า — เรียกจาก client ตอนกดปุ่ม
 *
 * `cache: "no-store"` เพราะสต็อกเปลี่ยนได้ทุกวินาที ห้ามใช้คำตอบเก่า
 * นี่คือการถาม backend ซึ่งเป็นเจ้าของความจริงเรื่องสต็อก
 */
export function checkAvailability(
  variantId: string,
  quantity: number,
): Promise<AvailabilityResult> {
  return apiFetch<AvailabilityResult>("/api/products/availability", {
    method: "POST",
    json: { variantId, quantity },
    cache: "no-store",
  });
}
