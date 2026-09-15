import { apiFetch } from "@/lib/api";
import type {
  AdjustStockInput,
  AdminOrder,
  AdminProduct,
  CreateProductInput,
  DeleteProductResult,
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
