import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AdminOrder,
  AdminOrderListResult,
  AdminOverview,
  AdminProduct,
  AdminProductListResult,
  ProductFormOptions,
} from "@/types/admin";

/**
 * อ่านข้อมูลหลังบ้านจากฝั่ง server (STEP 13–14)
 *
 * ทุก endpoint ต้องล็อกอิน + เป็นพนักงาน + มีสิทธิ์ตรงกับงาน (backend ตรวจ)
 * หน้า admin ตรวจสิทธิ์ซ้ำที่ layout/page ผ่าน DAL อีกชั้น
 */

export function fetchAdminOverviewOnServer(): Promise<AdminOverview> {
  return apiFetchAsUser<AdminOverview>("/api/admin/overview", { cache: "no-store" });
}

export function fetchAdminOrdersOnServer(params: URLSearchParams): Promise<AdminOrderListResult> {
  const qs = params.toString();

  return apiFetchAsUser<AdminOrderListResult>(`/api/admin/orders${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchAdminOrderOnServer(orderNumber: string): Promise<AdminOrder> {
  return apiFetchAsUser<AdminOrder>(`/api/admin/orders/${encodeURIComponent(orderNumber)}`, {
    cache: "no-store",
  });
}

export function fetchAdminProductsOnServer(
  params: URLSearchParams,
): Promise<AdminProductListResult> {
  const qs = params.toString();

  return apiFetchAsUser<AdminProductListResult>(`/api/admin/products${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchAdminProductOnServer(productId: string): Promise<AdminProduct> {
  return apiFetchAsUser<AdminProduct>(`/api/admin/products/${encodeURIComponent(productId)}`, {
    cache: "no-store",
  });
}

/** หมวดหมู่/แบรนด์/สี/ไซซ์ ที่มีจริงในฐานข้อมูล — ฟอร์มห้ามฮาร์ดโค้ดตัวเลือกเอง */
export function fetchProductFormOptionsOnServer(): Promise<ProductFormOptions> {
  return apiFetchAsUser<ProductFormOptions>("/api/admin/products/options", { cache: "no-store" });
}
