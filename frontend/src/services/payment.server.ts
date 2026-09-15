import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { PaymentState } from "@/types/catalog";

/** อ่านสถานะการชำระเงินจากฝั่ง server (STEP 11) — ต้องล็อกอิน */
export function fetchPaymentStateOnServer(orderNumber: string): Promise<PaymentState> {
  return apiFetchAsUser<PaymentState>(`/api/orders/${encodeURIComponent(orderNumber)}/payment`, {
    cache: "no-store",
  });
}
