/**
 * คืนสินค้าและคืนเงิน (STEP 43) — รูปเดียวกับ DTO ของ backend
 * (backend/src/models/return.model.ts · services/return.service.ts)
 *
 * ⚠️ หน้าเว็บ **ไม่คิดยอดเงินคืนเอง** — `estimatedRefund` มาจากสูตรเดียวกับที่ร้านใช้ตอนคืนเงินจริง
 */

export type ReturnStatus =
  "REQUESTED" | "APPROVED" | "RECEIVED" | "REFUNDED" | "REJECTED" | "CANCELLED";

export type ReturnReasonCode = "DEFECTIVE" | "WRONG_ITEM";

export type RefundMethodCode = "STRIPE_DASHBOARD" | "BANK_TRANSFER";

export interface ReturnReason {
  code: ReturnReasonCode;
  label: string;
  description: string;
}

export interface ReturnItem {
  id: string;
  orderItemId: string;
  productName: string;
  variantSku: string;
  colorName: string | null;
  sizeName: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  restocked: boolean;
}

export interface Refund {
  id: string;
  amount: number;
  method: RefundMethodCode;
  methodLabel: string;
  reference: string;
  note: string | null;
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  returnNumber: string;
  orderNumber: string;
  status: ReturnStatus;
  statusLabel: string;
  reason: ReturnReasonCode;
  reasonLabel: string;
  detail: string;
  /** ข้อความจากร้าน — ลูกค้าเห็น */
  staffNote: string | null;
  items: ReturnItem[];
  /** null = คำขอนี้ไม่ไปถึงการคืนเงิน (ไม่รับคืน/ยกเลิก) */
  estimatedRefund: number | null;
  refund: Refund | null;
  canCancel: boolean;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
}

export interface ReturnList<T = ReturnRequest> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReturnEligibility {
  orderNumber: string;
  eligible: boolean;
  /** เหตุผลที่ขอคืนไม่ได้ — null = ขอได้ */
  message: string | null;
  deadline: string | null;
  windowDays: number;
  reasons: ReturnReason[];
  detailMinLength: number;
  items: {
    orderItemId: string;
    productName: string;
    variantSku: string;
    colorName: string | null;
    sizeName: string | null;
    imageUrl: string | null;
    unitPrice: number;
    purchased: number;
    returnable: number;
  }[];
  requests: ReturnRequest[];
}

export interface CreateReturnInput {
  orderNumber: string;
  reason: ReturnReasonCode;
  detail: string;
  items: { orderItemId: string; quantity: number }[];
  idempotencyKey: string;
}

/* ─────────────────────────────── หลังบ้าน ─────────────────────────────── */

export interface Person {
  id: string;
  name: string | null;
  email: string;
}

export interface AdminReturnRequest extends ReturnRequest {
  customer: Person;
  orderTotal: number;
  orderRefundedTotal: number;
  paidWith: string | null;
  allowedDecisions: ReturnStatus[];
  canReceive: boolean;
  canRefund: boolean;
  refundMethods: { code: RefundMethodCode; label: string }[];
  refundRecordedBy: Person | null;
}

export interface CancelledPaidOrder {
  orderNumber: string;
  total: number;
  refundedTotal: number;
  cancelledAt: string | null;
  customer: Person;
}

export interface AdminReturnList extends ReturnList<AdminReturnRequest> {
  counts: { status: string; count: number }[];
  cancelledAwaitingRefund: CancelledPaidOrder[];
  cancelledAwaitingRefundCount: number;
}

export interface OrderRefundState {
  refundedTotal: number;
  awaitingRefund: boolean;
  refundableAmount: number;
  refundMethods: { code: RefundMethodCode; label: string }[];
  refunds: (Refund & { returnNumber: string | null; createdBy: Person | null })[];
}

export interface RecordRefundInput {
  method: RefundMethodCode;
  reference: string;
  note?: string;
  idempotencyKey: string;
}

export const RETURN_STATUS_TONE: Record<ReturnStatus, string> = {
  REQUESTED: "border-warning/30 bg-warning/5 text-warning",
  APPROVED: "border-brand-soft bg-lilac-50 text-brand-dark",
  RECEIVED: "border-brand-soft bg-lilac-50 text-brand-dark",
  REFUNDED: "border-success/30 bg-success/5 text-success",
  REJECTED: "border-danger/30 bg-danger/5 text-danger",
  CANCELLED: "border-line bg-white text-muted",
};
