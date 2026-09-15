import { apiFetch } from "@/lib/api";
import type {
  AdminOrder,
  AdminProduct,
  CreateProductInput,
  DeleteProductResult,
  ProductVariantInput,
  UpdateOrderStatusInput,
  UpdateProductInput,
  UpdateVariantInput,
} from "@/types/admin";

/**
 * ชั้นเดียวที่เรียก API หลังบ้านจากฝั่ง client (STEP 13–14)
 *
 * ⚠️ backend ตรวจสิทธิ์ (`order:update` / `product:create|update|delete`)
 *    และตรวจกฎธุรกิจทุกข้อเองทุกครั้ง — ปุ่มที่ซ่อน/แสดงใน UI เป็นเพียงความสะดวก
 *    ไม่ใช่การป้องกัน
 * ⚠️ **ไม่มีฟังก์ชันแก้จำนวนสต็อกที่นี่** สต็อกเดินผ่าน InventoryMovement เท่านั้น
 *    (รับเข้าครั้งแรกส่งเป็น `initialStock` ตอนสร้างตัวเลือก · ปรับยอดภายหลังคือ STEP 15)
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
