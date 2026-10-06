import { apiFetch } from "@/lib/api";
import type {
  AdminReturnRequest,
  CreateReturnInput,
  OrderRefundState,
  RecordRefundInput,
  ReturnRequest,
} from "@/types/returns";

/**
 * คืนสินค้าและคืนเงิน — ฝั่งเบราว์เซอร์ (STEP 43)
 *
 * ⚠️ ไม่มีฟิลด์ยอดเงินในคำขอใดเลย — ลูกค้าส่งได้แค่ชิ้น/จำนวน/เหตุผล
 *    พนักงานส่งได้แค่วิธีคืนเงินและเลขอ้างอิง · ยอดคิดที่ server
 */

export function createReturnRequest(input: CreateReturnInput): Promise<ReturnRequest> {
  return apiFetch<ReturnRequest>("/api/returns", {
    method: "POST",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}

export function cancelReturnRequest(returnId: string): Promise<ReturnRequest> {
  return apiFetch<ReturnRequest>(`/api/returns/${encodeURIComponent(returnId)}/cancel`, {
    method: "POST",
    cache: "no-store",
  });
}

export function decideReturn(
  returnId: string,
  input: { status: "APPROVED" | "REJECTED"; note?: string },
): Promise<AdminReturnRequest> {
  return apiFetch<AdminReturnRequest>(`/api/admin/returns/${encodeURIComponent(returnId)}/status`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

export function receiveReturn(
  returnId: string,
  input: { items: { returnItemId: string; restock: boolean }[]; note?: string },
): Promise<AdminReturnRequest> {
  return apiFetch<AdminReturnRequest>(
    `/api/admin/returns/${encodeURIComponent(returnId)}/receive`,
    { method: "POST", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}

export function refundReturn(
  returnId: string,
  input: RecordRefundInput,
): Promise<AdminReturnRequest & { applied: boolean }> {
  return apiFetch<AdminReturnRequest & { applied: boolean }>(
    `/api/admin/returns/${encodeURIComponent(returnId)}/refund`,
    { method: "POST", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}

export function refundCancelledOrder(
  orderNumber: string,
  input: RecordRefundInput,
): Promise<OrderRefundState & { applied: boolean }> {
  return apiFetch<OrderRefundState & { applied: boolean }>(
    `/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`,
    { method: "POST", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}
