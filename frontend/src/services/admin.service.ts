import { apiFetch } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import type {
  AdjustStockInput,
  AdminOrder,
  AdminProduct,
  AssignBarcodeResult,
  CreateProductInput,
  DeleteProductResult,
  FileFormat,
  InventoryImportResult,
  ProductImportResult,
  ProductVariantInput,
  UpdateOrderStatusInput,
  UpdateProductInput,
  StockAlertScanResult,
  UpdateVariantInput,
  VariantInventory,
} from "@/types/admin";

/**
 * ชั้นเดียวที่เรียก API หลังบ้านจากฝั่ง client (STEP 13–15)
 *
 * ⚠️ backend ตรวจสิทธิ์ (`order:update` / `product:*` / `inventory:adjust`)
 *    และตรวจกฎธุรกิจทุกข้อเองทุกครั้ง — ปุ่มที่ซ่อน/แสดงใน UI เป็นเพียงความสะดวก
 *    ไม่ใช่การป้องกัน
 * ⚠️ **ไม่มีฟังก์ชันเซ็ตจำนวนสต็อกตรง ๆ** — `adjustStock` บอกได้แค่ว่า
 *    รับเข้า/ตัดออกเท่าไร หรือนับได้เท่าไร แล้ว server บันทึกเป็น InventoryMovement
 */
export function updateOrderStatus(
  orderNumber: string,
  input: UpdateOrderStatusInput,
): Promise<AdminOrder> {
  return apiFetch<AdminOrder>(`/api/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function createProduct(input: CreateProductInput): Promise<AdminProduct> {
  return apiFetch<AdminProduct>("/api/admin/products", {
    method: "POST",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function updateProduct(productId: string, input: UpdateProductInput): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(`/api/admin/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

/** ลบสินค้า = soft delete ที่ backend (ประวัติคำสั่งซื้อยังอ้างอิงได้) */
export function deleteProduct(productId: string): Promise<DeleteProductResult> {
  return apiFetch<DeleteProductResult>(`/api/admin/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function addProductVariant(
  productId: string,
  input: ProductVariantInput,
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(`/api/admin/products/${encodeURIComponent(productId)}/variants`, {
    method: "POST",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function updateProductVariant(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(
    `/api/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
    { method: "PATCH", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}

/**
 * ปรับสต็อก (STEP 15) — รับเข้า / ตัดออก / ปรับตามการตรวจนับ
 *
 * `idempotencyKey` ต้องส่งทุกครั้ง (client สร้าง UUID ครั้งเดียวต่อการเปิดฟอร์ม)
 * เพื่อให้การกดปุ่มซ้ำหรือ retry ไม่ทำให้ยอดขยับสองเท่า
 */
export function adjustStock(variantId: string, input: AdjustStockInput): Promise<VariantInventory> {
  return apiFetch<VariantInventory>(
    `/api/admin/inventory/${encodeURIComponent(variantId)}/adjust`,
    { method: "POST", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}

/**
 * ตรวจเตือนสต็อกทั้งร้าน (STEP 16)
 *
 * ปกติระบบตรวจให้เองทุกครั้งที่สต็อกขยับ — ปุ่มนี้ไว้ตรวจย้อนของที่ตกเกณฑ์ไปก่อนหน้า
 */
export function scanStockAlerts(): Promise<StockAlertScanResult> {
  return apiFetch<StockAlertScanResult>("/api/admin/stock-alerts/scan", {
    method: "POST",
    cache: "no-store",
    timeoutMs: 60_000,
  });
}

/** รับทราบการแจ้งเตือน — ปิดรายการบนป้าย แต่ไม่ได้แก้ปัญหาสต็อก */
export function acknowledgeStockAlert(notificationId: string): Promise<{ acknowledged: boolean }> {
  return apiFetch<{ acknowledged: boolean }>(
    `/api/admin/stock-alerts/${encodeURIComponent(notificationId)}/ack`,
    { method: "PATCH", cache: "no-store", timeoutMs: 30_000 },
  );
}

/**
 * ออกบาร์โค้ดของร้านให้ตัวเลือกที่ยังไม่มี (STEP 17)
 *
 * ⚠️ ไม่เขียนทับเลขเดิม — ถ้ามีอยู่แล้ว backend ตอบ 409
 *    ต้องล้างค่าเดิม (ส่ง `barcode: null` ผ่าน `updateProductVariant`) ก่อน
 */
export function assignBarcode(variantId: string): Promise<AssignBarcodeResult> {
  return apiFetch<AssignBarcodeResult>("/api/admin/barcodes/assign", {
    method: "POST",
    json: { variantId },
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

/* ─────────────── นำเข้าและส่งออกข้อมูล (STEP 18) ─────────────── */

async function triggerFileDownload(path: string, fallbackFilename: string): Promise<void> {
  const base = publicEnv.apiUrl;
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "*/*" },
  });

  if (!response.ok) {
    let msg = "ดาวน์โหลดไฟล์ไม่สำเร็จ";
    try {
      const err = await response.json();
      if (err && err.message) msg = err.message;
    } catch {
      // fallback
    }
    throw new Error(msg);
  }

  const disposition = response.headers.get("Content-Disposition");
  let filename = fallbackFilename;
  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1];
  }

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export function downloadAdminExport(
  type: "products" | "inventory" | "orders",
  format: FileFormat,
  query = "",
): Promise<void> {
  const q = query ? `&${query.replace(/^\?/, "")}` : "";
  return triggerFileDownload(
    `/api/admin/export/${type}?format=${format}${q}`,
    `${type}_export.${format}`,
  );
}

export function downloadAdminTemplate(
  type: "products" | "inventory",
  format: FileFormat,
): Promise<void> {
  return triggerFileDownload(
    `/api/admin/export/templates/${type}?format=${format}`,
    `${type}_template.${format}`,
  );
}

async function uploadFile<T>(path: string, file: File, dryRun = false): Promise<T> {
  const base = publicEnv.apiUrl;
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${path.includes("?") ? "&" : "?"}dryRun=${dryRun}`;
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
    body: formData,
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.message || "อัปโหลดไฟล์ไม่สำเร็จ");
  }

  return json.data as T;
}

export function importAdminProducts(file: File, dryRun = false): Promise<ProductImportResult> {
  return uploadFile<ProductImportResult>("/api/admin/import/products", file, dryRun);
}

export function importAdminInventory(file: File, dryRun = false): Promise<InventoryImportResult> {
  return uploadFile<InventoryImportResult>("/api/admin/import/inventory", file, dryRun);
}

/**
 * ดาวน์โหลดรายงานยอดขายของช่วงที่เลือก (STEP 26)
 *
 * ใช้ตัวช่วยดาวน์โหลดตัวเดียวกับการส่งออกของ STEP 18 เพื่อให้เรื่อง cookie
 * ชื่อไฟล์จาก `Content-Disposition` และการจัดการ error เป็นแบบเดียวกันทั้งระบบ
 */
export function downloadAnalyticsReport(query: string, format: FileFormat): Promise<void> {
  const q = query.replace(/^\?/, "");

  return triggerFileDownload(
    `/api/admin/analytics/export?format=${format}${q ? `&${q}` : ""}`,
    `analytics_report.${format}`,
  );
}
