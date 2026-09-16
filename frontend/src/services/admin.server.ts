import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AdminOrder,
  AdminOrderListResult,
  AdminOverview,
  AdminProduct,
  AdminProductListResult,
  BarcodeLookupResult,
  InventoryListResult,
  LabelSheet,
  MovementListResult,
  ProductFormOptions,
  StockAlertListResult,
  VariantInventory,
} from "@/types/admin";

/**
 * อ่านข้อมูลหลังบ้านจากฝั่ง server (STEP 13–16)
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

export function fetchInventoryOnServer(params: URLSearchParams): Promise<InventoryListResult> {
  const qs = params.toString();

  return apiFetchAsUser<InventoryListResult>(`/api/admin/inventory${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchVariantInventoryOnServer(variantId: string): Promise<VariantInventory> {
  return apiFetchAsUser<VariantInventory>(`/api/admin/inventory/${encodeURIComponent(variantId)}`, {
    cache: "no-store",
  });
}

export function fetchStockAlertsOnServer(params: URLSearchParams): Promise<StockAlertListResult> {
  const qs = params.toString();

  return apiFetchAsUser<StockAlertListResult>(`/api/admin/stock-alerts${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchMovementsOnServer(params: URLSearchParams): Promise<MovementListResult> {
  const qs = params.toString();

  return apiFetchAsUser<MovementListResult>(`/api/admin/inventory/movements${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

/**
 * ค้นหาจากบาร์โค้ด/SKU ที่สแกนหรือพิมพ์มา (STEP 17)
 *
 * เรียกจากฝั่ง server ได้เพราะเป็น GET — หน้าสแกนจึงเป็นฟอร์ม GET ธรรมดา
 * ที่ทำงานได้แม้ JS ยังไม่โหลด (เครื่องสแกนแบบ keyboard wedge พิมพ์โค้ดแล้วกด Enter)
 */
export function fetchBarcodeLookupOnServer(code: string): Promise<BarcodeLookupResult> {
  return apiFetchAsUser<BarcodeLookupResult>(
    `/api/admin/barcodes/lookup?code=${encodeURIComponent(code)}`,
    { cache: "no-store" },
  );
}

/** ป้ายบาร์โค้ด/QR ที่ backend วาดเป็น SVG มาแล้ว — ข้อความทุกตัวมาจากฐานข้อมูล */
export function fetchBarcodeLabelsOnServer(params: URLSearchParams): Promise<LabelSheet> {
  return apiFetchAsUser<LabelSheet>(`/api/admin/barcodes/labels?${params.toString()}`, {
    cache: "no-store",
  });
}
