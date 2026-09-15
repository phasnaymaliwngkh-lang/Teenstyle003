/**
 * ป้ายสถานะคำสั่งซื้อ (STEP 12)
 *
 * ค่าจริงในฐานข้อมูลเป็น enum ภาษาอังกฤษ (`OrderStatus` / `PaymentStatus`)
 * การแปลและสีเป็นเรื่องของ UI จึงเก็บไว้ที่นี่ที่เดียว
 */

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "รอชำระเงิน",
  PAID: "ชำระเงินแล้ว",
  PROCESSING: "ร้านรับออเดอร์",
  PACKING: "กำลังแพ็กสินค้า",
  SHIPPING: "กำลังจัดส่ง",
  DELIVERED: "ได้รับสินค้าแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
  REFUNDED: "คืนเงินแล้ว",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอชำระเงิน",
  PROCESSING: "กำลังตรวจสอบการชำระเงิน",
  PAID: "ชำระเงินแล้ว",
  FAILED: "ชำระเงินไม่สำเร็จ",
  REFUNDED: "คืนเงินแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
  PARTIALLY_REFUNDED: "คืนเงินบางส่วน",
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "เตรียมจัดส่ง",
  PREPARING: "กำลังเตรียมพัสดุ",
  SHIPPED: "ส่งออกแล้ว",
  IN_TRANSIT: "อยู่ระหว่างขนส่ง",
  DELIVERED: "ส่งถึงแล้ว",
  FAILED: "ส่งไม่สำเร็จ",
  RETURNED: "ตีกลับ",
};

/** สีของ chip สถานะ — ใช้ token ของแบรนด์เท่านั้น */
export function orderStatusTone(status: string): string {
  switch (status) {
    case "DELIVERED":
    case "PAID":
      return "border-success/30 bg-success/10 text-success";
    case "CANCELLED":
    case "REFUNDED":
      return "border-line bg-lilac-50 text-muted";
    case "PENDING_PAYMENT":
      return "border-warning/30 bg-warning/10 text-warning";
    default:
      return "border-brand/30 bg-lilac text-brand-dark";
  }
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status;
}

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABEL[status] ?? status;
}

export function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABEL[status] ?? status;
}

/** วันเวลาแบบไทยที่อ่านง่าย */
export function formatDateTime(value: string | null): string {
  if (value === null) return "—";

  return new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
