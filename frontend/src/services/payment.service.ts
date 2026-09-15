import { apiFetch } from "@/lib/api";
import type { Order, PaymentProviderCode, PaymentState, StartPaymentResult } from "@/types/catalog";

/**
 * ชั้นเดียวที่เรียก API การชำระเงิน (STEP 11)
 *
 * ⚠️ client บอกได้แค่ "จะจ่ายวิธีไหน" — ยอดเงินอ่านจากออเดอร์ที่ server
 * ⚠️ ไม่มีฟังก์ชันใดที่ทำให้ออเดอร์ "จ่ายแล้ว" ได้จากฝั่ง client
 *    สถานะจ่ายแล้วเปลี่ยนได้เฉพาะจาก webhook ที่ลายเซ็นถูกต้อง (หรือ COD ที่ server ยืนยัน)
 * ⚠️ ห้าม cache — สถานะการชำระเงินต้องสดเสมอ
 */

export function fetchPaymentState(orderNumber: string): Promise<PaymentState> {
  return apiFetch<PaymentState>(`/api/orders/${encodeURIComponent(orderNumber)}/payment`, {
    cache: "no-store",
  });
}

export function startPayment(
  orderNumber: string,
  provider: PaymentProviderCode,
): Promise<StartPaymentResult> {
  return apiFetch<StartPaymentResult>(`/api/orders/${encodeURIComponent(orderNumber)}/pay`, {
    method: "POST",
    json: { provider },
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function cancelOrder(orderNumber: string): Promise<Order> {
  return apiFetch<Order>(`/api/orders/${encodeURIComponent(orderNumber)}/cancel`, {
    method: "POST",
    cache: "no-store",
    timeoutMs: 30_000,
  });
}
