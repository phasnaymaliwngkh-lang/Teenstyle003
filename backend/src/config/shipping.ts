/**
 * ตัวเลือกและค่าจัดส่ง (STEP 10)
 *
 * ⚠️ นี่คือ **แหล่งความจริงเดียว** ของค่าจัดส่ง — ทั้งหน้า checkout ที่แสดงให้ผู้ใช้ดู
 *    และยอดที่บันทึกลงคำสั่งซื้อ ใช้ฟังก์ชันเดียวกันนี้คำนวณ
 *    จึงไม่มีทางที่ตัวเลขที่ผู้ใช้เห็นจะต่างจากที่เก็บเงิน
 *
 * ค่าเหล่านี้เป็นค่าตั้งต้นของร้านที่ฝังในโค้ด — **STEP 44 (Shipping Management)**
 * จะย้ายไปเป็นข้อมูลในฐานข้อมูลให้ admin แก้ได้เอง (ตอนนั้นให้ service อ่านจาก DB แทน)
 */

export const SHIPPING_METHODS = ['STANDARD', 'EXPRESS', 'SAME_DAY', 'PICKUP'] as const;

export type ShippingMethodCode = (typeof SHIPPING_METHODS)[number];

export interface ShippingOption {
  code: ShippingMethodCode;
  name: string;
  description: string;
  /** ค่าส่งปกติ (บาท) */
  baseFee: number;
  /** ยอดสินค้าที่ทำให้ส่งฟรี (null = ไม่มีโปรส่งฟรี) */
  freeOverSubtotal: number | null;
  /** ระยะเวลาที่บอกลูกค้า */
  etaText: string;
  /** จำกัดเฉพาะบางจังหวัด (null = ทั่วประเทศ) */
  onlyProvinces: string[] | null;
}

export const SHIPPING_OPTIONS: readonly ShippingOption[] = [
  {
    code: 'STANDARD',
    name: 'ส่งธรรมดา',
    description: 'ไปรษณีย์ไทย / Flash — ส่งฟรีเมื่อซื้อครบ 1,000 บาท',
    baseFee: 50,
    freeOverSubtotal: 1000,
    etaText: '2–4 วันทำการ',
    onlyProvinces: null,
  },
  {
    code: 'EXPRESS',
    name: 'ส่งด่วน',
    description: 'ส่งเร็วขึ้น มีเลขติดตามทุกออเดอร์',
    baseFee: 120,
    freeOverSubtotal: null,
    etaText: '1–2 วันทำการ',
    onlyProvinces: null,
  },
  {
    code: 'SAME_DAY',
    name: 'ส่งวันเดียวกัน',
    description: 'สั่งก่อน 12:00 ส่งถึงภายในวันเดียวกัน (เฉพาะกรุงเทพฯ และปริมณฑล)',
    baseFee: 250,
    freeOverSubtotal: null,
    etaText: 'ภายในวันเดียวกัน',
    onlyProvinces: ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ'],
  },
  {
    code: 'PICKUP',
    name: 'รับที่ร้าน',
    description: 'รับเองที่หน้าร้าน ไม่มีค่าจัดส่ง',
    baseFee: 0,
    freeOverSubtotal: null,
    etaText: 'พร้อมรับภายใน 1 วันทำการ',
    onlyProvinces: null,
  },
];

export function findShippingOption(code: ShippingMethodCode): ShippingOption {
  const option = SHIPPING_OPTIONS.find((item) => item.code === code);

  // SHIPPING_METHODS ถูกตรวจด้วย Zod แล้ว จึงไม่ควรเกิด — แต่กันไว้ไม่ให้เงียบ
  if (!option) {
    throw new Error(`ไม่รู้จักวิธีจัดส่ง: ${code}`);
  }

  return option;
}

/** ค่าจัดส่งจริงของตัวเลือกหนึ่ง ตามยอดสินค้า */
export function calculateShippingFee(code: ShippingMethodCode, subtotal: number): number {
  const option = findShippingOption(code);

  if (option.freeOverSubtotal !== null && subtotal >= option.freeOverSubtotal) {
    return 0;
  }

  return option.baseFee;
}

/** ตัวเลือกนี้ใช้กับจังหวัดนี้ได้ไหม */
export function isShippingAvailable(code: ShippingMethodCode, province: string): boolean {
  const option = findShippingOption(code);

  if (option.onlyProvinces === null) return true;

  return option.onlyProvinces.includes(province.trim());
}
