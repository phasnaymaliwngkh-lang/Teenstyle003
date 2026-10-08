/**
 * เงื่อนไขการคืนสินค้าและคืนเงิน (STEP 43)
 *
 * ⚠️ **แหล่งความจริงเดียว** ของกติกาการคืน — ทั้งด่านจริงที่ backend ฟอร์มที่ลูกค้ากรอก
 *    บทความนโยบายในคลังความรู้ และคำตอบของ AI Customer Service อ่านจากไฟล์นี้
 *    (บทเรียน STEP 21: นโยบายสองชุดที่พิมพ์แยกกัน = ลูกค้าถามสองทางได้คนละคำตอบ)
 *
 * จำนวนวันที่แจ้งคืนได้ย้ายไปการตั้งค่าร้านตอน STEP 49 (`StoreSetting.returnWindowDays`)
 * และแต่ละคำสั่งซื้อจดค่าที่ใช้ตอนสั่งไว้ (`Order.returnWindowDays`) — ดู `effectiveReturnWindowDays()`
 */

export const RETURN_REASON_CODES = ['DEFECTIVE', 'WRONG_ITEM'] as const;

export type ReturnReasonCode = (typeof RETURN_REASON_CODES)[number];

export interface ReturnReasonRule {
  code: ReturnReasonCode;
  label: string;
  /** อธิบายให้ลูกค้าเลือกถูก — ต้องตรงกับนโยบายในบทความ */
  description: string;
}

/**
 * เหตุผลที่ยื่นคำขอคืนเงินได้ — **รับคืนเฉพาะกรณีที่เป็นความผิดของร้าน** ตามนโยบายเดิมของร้าน
 *
 * ⚠️ "ใส่ไม่พอดี / เปลี่ยนใจ" **ไม่อยู่ในรายการนี้โดยเจตนา** — นโยบายร้านคือ "เปลี่ยนไซซ์"
 *    ไม่ใช่ "คืนเงิน" และการเปลี่ยนไซซ์ต้องส่งของชิ้นใหม่ (คำสั่งซื้อใหม่ · ค่าส่ง · สต็อก)
 *    ซึ่งยังไม่มีระบบรองรับ → ให้ติดต่อฝ่ายบริการลูกค้า (หน้าฟอร์มบอกตรง ๆ)
 */
export const RETURN_REASONS: readonly ReturnReasonRule[] = [
  {
    code: 'DEFECTIVE',
    label: 'สินค้ามีตำหนิจากการผลิต',
    description: 'เช่น ตะเข็บแตก ผ้ามีรู สีด่าง ซิปเสีย ตั้งแต่ตอนได้รับ',
  },
  {
    code: 'WRONG_ITEM',
    label: 'ร้านส่งสินค้าผิด',
    description: 'ได้ผิดแบบ ผิดสี หรือผิดไซซ์จากที่สั่งไว้',
  },
];

/** รายละเอียดที่ลูกค้าต้องเล่าอย่างน้อยกี่ตัวอักษร — ร้านต้องรู้ว่าตำหนิอยู่ตรงไหน */
export const RETURN_DETAIL_MIN_LENGTH = 10;

export const REFUND_METHOD_CODES = ['STRIPE_DASHBOARD', 'BANK_TRANSFER'] as const;

export type RefundMethodCode = (typeof REFUND_METHOD_CODES)[number];

export const REFUND_METHOD_LABEL: Record<RefundMethodCode, string> = {
  STRIPE_DASHBOARD: 'คืนผ่าน Stripe Dashboard',
  BANK_TRANSFER: 'โอนเงินคืนเข้าบัญชีลูกค้า',
};

/**
 * ช่องทางที่ใช้คืนเงินได้ ตามช่องทางที่ลูกค้าจ่ายมา
 *
 * - จ่ายผ่าน Stripe → ต้องคืนกลับบัตร/ช่องทางเดิมผ่าน Stripe (หรือโอนถ้า Stripe คืนไม่ได้แล้ว)
 * - เก็บเงินปลายทาง → เงินสดอยู่กับร้าน คืนได้ทางเดียวคือโอนเข้าบัญชี
 */
export function refundMethodsFor(paidWith: string | null): RefundMethodCode[] {
  return paidWith === 'STRIPE' ? ['STRIPE_DASHBOARD', 'BANK_TRANSFER'] : ['BANK_TRANSFER'];
}
