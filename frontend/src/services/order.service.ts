import { apiFetch } from "@/lib/api";
import type {
  CheckoutSummary,
  CouponApplyResult,
  CreateOrderInput,
  Order,
  ShippingMethodCode,
} from "@/types/catalog";

/**
 * ชั้นเดียวที่เรียก API ของ checkout/คำสั่งซื้อ (STEP 10)
 *
 * ⚠️ ห้าม cache — ยอดเงิน สต็อก และสถานะคำสั่งซื้อต้องเป็นค่าล่าสุดเสมอ
 * ⚠️ ส่งไปได้แค่ที่อยู่ + วิธีจัดส่ง + idempotencyKey
 *    ราคา/ยอดรวม/รายการสินค้า คำนวณจากตะกร้าที่ server ทั้งหมด
 *
 * ทุก endpoint ต้องล็อกอิน — เรียกจาก client ได้เพราะ `apiFetch` แนบ cookie ให้
 * (ตอน dev เบราว์เซอร์ส่ง cookie ข้าม port ได้ · production ใช้หน้า server เป็นตัวอ่าน)
 */

export function fetchCheckoutSummary(
  shippingMethod: ShippingMethodCode,
  couponCode?: string,
): Promise<CheckoutSummary> {
  const query = new URLSearchParams({ shippingMethod });

  if (couponCode) query.set("couponCode", couponCode);

  return apiFetch<CheckoutSummary>(`/api/checkout/summary?${query.toString()}`, {
    cache: "no-store",
  });
}

/**
 * ตรวจคูปองกับตะกร้าของตัวเอง (STEP 41)
 *
 * ⚠️ **ยังไม่ถือว่าใช้คูปอง** — โควตาถูกจองตอนสร้างคำสั่งซื้อเท่านั้น
 *    และ server คิดส่วนลดใหม่อีกครั้งตอนนั้น ค่าที่ได้จากที่นี่ใช้แสดงผลล่วงหน้าเท่านั้น
 */
export function applyCoupon(
  code: string,
  shippingMethod: ShippingMethodCode,
): Promise<CouponApplyResult> {
  return apiFetch<CouponApplyResult>("/api/coupons/apply", {
    method: "POST",
    json: { code, shippingMethod },
    cache: "no-store",
  });
}

export function createOrder(input: CreateOrderInput): Promise<Order> {
  return apiFetch<Order>("/api/orders", {
    method: "POST",
    json: input,
    cache: "no-store",
    // การสั่งซื้อใช้เวลามากกว่าปกติ (ทรานแซกชัน + จองสต็อก)
    timeoutMs: 30_000,
  });
}

export function fetchOrder(orderNumber: string): Promise<Order> {
  return apiFetch<Order>(`/api/orders/${encodeURIComponent(orderNumber)}`, {
    cache: "no-store",
  });
}
