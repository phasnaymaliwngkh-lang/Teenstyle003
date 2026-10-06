"use client";

import { refundCancelledOrder } from "@/services/returns.service";
import type { OrderRefundState } from "@/types/returns";

import { RefundForm } from "./refund-form";

/**
 * คืนเงินคำสั่งซื้อที่ร้านยกเลิกหลังชำระเงินแล้ว (STEP 43)
 *
 * เดิมยกเลิกใบที่จ่ายแล้วได้ (STEP 13) แต่ไม่มีที่บันทึกว่าคืนเงินแล้ว — ใบนั้นค้างเป็น
 * "ยกเลิก + จ่ายแล้ว" ตลอดไป โดยไม่มีใครรู้ว่าเงินของลูกค้ากลับไปหรือยัง
 */
export function OrderRefundPanel({
  orderNumber,
  state,
}: {
  orderNumber: string;
  state: OrderRefundState;
}) {
  return (
    <RefundForm
      amount={state.refundableAmount}
      methods={state.refundMethods}
      submit={(input) => refundCancelledOrder(orderNumber, input)}
    />
  );
}
