/**
 * คำอธิบายชนิดการเคลื่อนไหวของสต็อก (STEP 15)
 *
 * ⚠️ ป้ายพวกนี้ต้องอธิบาย "สิ่งที่เกิดขึ้นจริง" ไม่ใช่แค่แปลชื่อ enum
 *    เพราะแอดมินต้องอ่านประวัติแล้วเข้าใจได้ว่าของหายไปไหน
 */

export const MOVEMENT_TYPES = [
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
  "RETURN",
  "TRANSFER",
] as const;

export function movementLabel(type: string): string {
  switch (type) {
    case "STOCK_IN":
      return "รับเข้า";
    case "STOCK_OUT":
      return "ตัดออก";
    case "ADJUSTMENT":
      return "ปรับยอด";
    case "RETURN":
      return "รับคืน";
    case "TRANSFER":
      return "ย้ายคลัง";
    default:
      return type;
  }
}

/** เหตุที่ทำให้เกิดรายการ — ช่วยแยกว่าคนทำหรือระบบทำ */
export function movementSource(referenceType: string | null): string {
  switch (referenceType) {
    case "ORDER":
      return "จากคำสั่งซื้อ";
    case "PRODUCT":
      return "จากการสร้างสินค้า";
    case "MANUAL":
      return "แอดมินทำเอง";
    case null:
      return "ระบบ";
    default:
      return referenceType;
  }
}

export function stockStatusLabel(status: string): string {
  switch (status) {
    case "OUT_OF_STOCK":
      return "หมด";
    case "LOW_STOCK":
      return "เหลือน้อย";
    default:
      return "พร้อมขาย";
  }
}

export function stockStatusTone(status: string): string {
  switch (status) {
    case "OUT_OF_STOCK":
      return "border-danger/30 bg-danger/10 text-danger";
    case "LOW_STOCK":
      return "border-warning/30 bg-warning/10 text-warning";
    default:
      return "border-success/30 bg-success/10 text-success";
  }
}

/** ป้ายของ delta: + เขียว, − แดง (ค่า 0 เกิดขึ้นไม่ได้ ระบบปฏิเสธไปก่อน) */
export function deltaTone(delta: number): string {
  return delta > 0 ? "text-success" : "text-danger";
}

export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}
