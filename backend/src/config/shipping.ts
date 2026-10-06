/**
 * วิธีจัดส่ง (STEP 10 · ย้ายตัวเลขไปฐานข้อมูลตอน STEP 44)
 *
 * ⚠️ **ไฟล์นี้ไม่มีตัวเลขเงินแล้ว** — ค่าส่ง ยอดส่งฟรี ระยะเวลา และพื้นที่ให้บริการอยู่ในตาราง
 *    `ShippingRate` ที่ร้านแก้เองได้จาก /admin/shipping (แหล่งความจริงเดียว)
 *    อ่านผ่าน `services/shipping.service.ts` · กฎการคิดเงินอยู่ที่ `models/shipping.model.ts`
 *
 * ที่เหลือในไฟล์นี้คือ **ความหมายของแต่ละวิธี** ซึ่งคงที่ — enum `ShippingMethod` ถูกอ้างจาก
 * คำสั่งซื้อทุกใบ ถ้าให้แก้ชื่อได้ "ส่งธรรมดา" ในประวัติคำสั่งซื้อเก่าจะกลายเป็นชื่ออื่นตาม
 * (ต้องตรงกับ enum `ShippingMethod` ใน schema.prisma)
 */

export const SHIPPING_METHODS = ['STANDARD', 'EXPRESS', 'SAME_DAY', 'PICKUP'] as const;

export type ShippingMethodCode = (typeof SHIPPING_METHODS)[number];

export const SHIPPING_METHOD_NAME: Readonly<Record<ShippingMethodCode, string>> = {
  STANDARD: 'ส่งธรรมดา',
  EXPRESS: 'ส่งด่วน',
  SAME_DAY: 'ส่งวันเดียวกัน',
  PICKUP: 'รับที่ร้าน',
};
