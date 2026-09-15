import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { CheckoutSummary, Order, OrderListResult, ShippingMethodCode } from "@/types/catalog";

/**
 * อ่านข้อมูล checkout/คำสั่งซื้อจากฝั่ง server (STEP 10)
 *
 * ใช้ `apiFetchAsUser` เพราะทุก endpoint ต้องล็อกอิน
 * (ส่ง session token ต่อเป็น `Authorization: Bearer` — production คนละโดเมน)
 */

export function fetchCheckoutSummaryOnServer(
  shippingMethod: ShippingMethodCode = "STANDARD",
): Promise<CheckoutSummary> {
  return apiFetchAsUser<CheckoutSummary>(`/api/checkout/summary?shippingMethod=${shippingMethod}`, {
    cache: "no-store",
  });
}

export function fetchOrderOnServer(orderNumber: string): Promise<Order> {
  return apiFetchAsUser<Order>(`/api/orders/${encodeURIComponent(orderNumber)}`, {
    cache: "no-store",
  });
}

/** ประวัติคำสั่งซื้อของผู้ใช้ (STEP 12) — backend กรอง userId ให้เสมอ */
export function fetchMyOrdersOnServer(params: URLSearchParams): Promise<OrderListResult> {
  const qs = params.toString();

  return apiFetchAsUser<OrderListResult>(`/api/orders${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}
