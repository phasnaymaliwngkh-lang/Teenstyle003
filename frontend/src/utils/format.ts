/**
 * ฟังก์ชันจัดรูปแบบข้อความ — pure function ไม่ผูกกับ React
 */

/** จัดรูปแบบราคาเป็นบาทตามรูปแบบไทย เช่น 1,490.- */
export function formatBaht(value: number): string {
  return `${value.toLocaleString("th-TH", { maximumFractionDigits: 0 })}.-`;
}

/** ข้อความสถานะสต็อกที่ผู้ใช้เข้าใจ */
export const STOCK_LABEL = {
  IN_STOCK: "พร้อมส่ง",
  LOW_STOCK: "เหลือน้อย",
  OUT_OF_STOCK: "สินค้าหมด",
} as const;
