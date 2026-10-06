import type { Prisma } from '@teenstyle/database';

import { SHIPPING_METHOD_NAME, type ShippingMethodCode } from '../config/shipping.ts';
import { toNumber } from './pricing.ts';

/**
 * กฎของการจัดส่ง — **แหล่งความจริงเดียว** (STEP 10 · ย้ายตัวเลขไปฐานข้อมูลตอน STEP 44)
 *
 * ค่าส่งที่โชว์ในหน้า checkout · ค่าส่งที่บันทึกลงคำสั่งซื้อ · ส่วนลดของคูปองส่งฟรี ·
 * บทความนโยบายในคลังความรู้ · คำตอบของ AI Customer Service ใช้ฟังก์ชันจากไฟล์นี้ทั้งหมด
 * กับข้อมูลชุดเดียวกันจากตาราง `ShippingRate` — ตัวเลขที่ลูกค้าเห็นจึงต่างจากที่เก็บเงินไม่ได้
 *
 * ทุกฟังก์ชันเป็นฟังก์ชันบริสุทธิ์ (ผู้เรียกโหลดข้อมูลมาเอง) เทสต์ป้อนค่าได้ตรง ๆ
 */

export interface ShippingOption {
  code: ShippingMethodCode;
  /** ชื่อคงที่ตาม enum — ไม่อยู่ในฐานข้อมูล (ดู config/shipping.ts) */
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
  isActive: boolean;
  sortOrder: number;
}

export const SHIPPING_RATE_SELECT = {
  method: true,
  description: true,
  baseFee: true,
  freeOverSubtotal: true,
  etaText: true,
  onlyProvinces: true,
  isActive: true,
  sortOrder: true,
  updatedAt: true,
} satisfies Prisma.ShippingRateSelect;

export type ShippingRateRow = Prisma.ShippingRateGetPayload<{
  select: typeof SHIPPING_RATE_SELECT;
}>;

export function toShippingOption(row: ShippingRateRow): ShippingOption {
  const code = row.method as ShippingMethodCode;

  return {
    code,
    name: SHIPPING_METHOD_NAME[code],
    description: row.description,
    baseFee: toNumber(row.baseFee),
    freeOverSubtotal: row.freeOverSubtotal === null ? null : toNumber(row.freeOverSubtotal),
    etaText: row.etaText,
    // อาร์เรย์ว่างในฐานข้อมูล = ทั่วประเทศ · DTO ใช้ null ตามรูปเดิมที่หน้า checkout อ่านอยู่
    onlyProvinces: row.onlyProvinces.length === 0 ? null : row.onlyProvinces,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/** แปลงเป็นสตางค์จำนวนเต็มก่อนเทียบ — บทเรียนทศนิยมลอยของ STEP 42 */
const toSatang = (baht: number): number => Math.round(baht * 100);

/** ค่าจัดส่งจริงของตัวเลือกหนึ่ง ตามยอดสินค้า */
export function calculateShippingFee(option: ShippingOption, subtotal: number): number {
  if (option.freeOverSubtotal !== null && toSatang(subtotal) >= toSatang(option.freeOverSubtotal)) {
    return 0;
  }

  return option.baseFee;
}

/** ตัวเลือกนี้ใช้กับจังหวัดนี้ได้ไหม (ไม่ดูว่าเปิดใช้อยู่ไหม — ผู้เรียกตรวจ `isActive` เอง) */
export function isShippingAvailable(option: ShippingOption, province: string): boolean {
  if (option.onlyProvinces === null) return true;

  return option.onlyProvinces.includes(province.trim());
}

/* ───────────────────────── ข้อความนโยบาย (บทความ + AI) ───────────────────────── */

const formatBaht = (amount: number): string => amount.toLocaleString('th-TH');

/**
 * ทุกฟังก์ชันด้านล่างรับ **เฉพาะวิธีที่เปิดใช้** — วิธีที่ปิดไว้ห้ามโผล่ในนโยบายที่บอกลูกค้า
 * (ปิด "ส่งวันเดียวกัน" แล้วบทความยังโฆษณาอยู่ = ลูกค้าเลือกไม่ได้แล้วคิดว่าระบบพัง)
 */
const activeOnly = (options: readonly ShippingOption[]): ShippingOption[] =>
  options.filter((option) => option.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

/** ตารางอัตราค่าจัดส่ง — บรรทัดละวิธี */
export function describeShippingRates(options: readonly ShippingOption[]): string {
  const lines = activeOnly(options).map((option) => {
    const fee = option.baseFee === 0 ? 'ไม่มีค่าใช้จ่าย' : `${formatBaht(option.baseFee)} บาท`;
    const free =
      option.freeOverSubtotal !== null
        ? ` — ฟรีเมื่อยอดสินค้าครบ ${formatBaht(option.freeOverSubtotal)} บาท`
        : '';
    const area =
      option.onlyProvinces !== null ? ` (ให้บริการเฉพาะ ${option.onlyProvinces.join(', ')})` : '';

    return `- **${option.name}** — ${fee}${free} · ระยะเวลา ${option.etaText}${area}\n  ${option.description}`;
  });

  return lines.length > 0 ? lines.join('\n') : '- ตอนนี้ร้านยังไม่เปิดให้เลือกวิธีจัดส่ง';
}

/**
 * ประโยคเรื่องส่งฟรี — **ไม่มีโปรส่งฟรีต้องบอกว่าไม่มี** ห้ามเหลือประโยค "ส่งฟรีเมื่อครบ 0 บาท"
 * (ข้อความเดิมของ STEP 21 ใช้ `freeOverSubtotal ?? 0` ซึ่งจะกลายเป็นแบบนั้นทันทีที่ปิดโปร)
 */
export function describeFreeShipping(options: readonly ShippingOption[]): string {
  const free = activeOnly(options).filter((option) => option.freeOverSubtotal !== null);

  if (free.length === 0) return 'ตอนนี้ร้านไม่มีโปรส่งฟรี ค่าส่งคิดตามวิธีจัดส่งที่เลือก';

  return free
    .map((option) => {
      const area =
        option.onlyProvinces !== null ? ` (เฉพาะ ${option.onlyProvinces.join(', ')})` : '';

      return `ส่งฟรีโดยไม่ต้องใส่โค้ด เมื่อยอดสินค้าครบ ${formatBaht(option.freeOverSubtotal!)} บาท และเลือกวิธี "${option.name}"${area}`;
    })
    .join(' · ');
}

/** ระยะเวลาจัดส่งแบบบรรทัดเดียว */
export function describeShippingEta(options: readonly ShippingOption[]): string {
  const active = activeOnly(options);

  return active.length > 0
    ? active.map((option) => `${option.name} ${option.etaText}`).join(' · ')
    : 'ตอนนี้ร้านยังไม่เปิดให้เลือกวิธีจัดส่ง';
}

/** รายชื่อวิธีที่เลือกได้ */
export function describeShippingMethods(options: readonly ShippingOption[]): string {
  const active = activeOnly(options);

  return active.length > 0
    ? active.map((option) => option.name).join(' · ')
    : 'ยังไม่เปิดให้เลือกวิธีจัดส่ง';
}

/* ───────────────────────── จังหวัด ───────────────────────── */

/**
 * จังหวัดของไทย 77 จังหวัด (รวมกรุงเทพมหานคร) — ใช้ตรวจรายการ "เฉพาะจังหวัด" ที่ร้านกรอก
 *
 * ⚠️ การเทียบจังหวัดเป็นการเทียบข้อความตรงตัว ถ้าร้านพิมพ์ "กรุงเทพฯ" ไว้ ลูกค้าที่กรอก
 *    "กรุงเทพมหานคร" จะเลือกวิธีนั้นไม่ได้เลยโดยไม่มีอะไรฟ้อง → รับเฉพาะชื่อในรายการนี้
 */
export const THAI_PROVINCES: readonly string[] = [
  'กรุงเทพมหานคร',
  'กระบี่',
  'กาญจนบุรี',
  'กาฬสินธุ์',
  'กำแพงเพชร',
  'ขอนแก่น',
  'จันทบุรี',
  'ฉะเชิงเทรา',
  'ชลบุรี',
  'ชัยนาท',
  'ชัยภูมิ',
  'ชุมพร',
  'เชียงราย',
  'เชียงใหม่',
  'ตรัง',
  'ตราด',
  'ตาก',
  'นครนายก',
  'นครปฐม',
  'นครพนม',
  'นครราชสีมา',
  'นครศรีธรรมราช',
  'นครสวรรค์',
  'นนทบุรี',
  'นราธิวาส',
  'น่าน',
  'บึงกาฬ',
  'บุรีรัมย์',
  'ปทุมธานี',
  'ประจวบคีรีขันธ์',
  'ปราจีนบุรี',
  'ปัตตานี',
  'พระนครศรีอยุธยา',
  'พะเยา',
  'พังงา',
  'พัทลุง',
  'พิจิตร',
  'พิษณุโลก',
  'เพชรบุรี',
  'เพชรบูรณ์',
  'แพร่',
  'ภูเก็ต',
  'มหาสารคาม',
  'มุกดาหาร',
  'แม่ฮ่องสอน',
  'ยโสธร',
  'ยะลา',
  'ร้อยเอ็ด',
  'ระนอง',
  'ระยอง',
  'ราชบุรี',
  'ลพบุรี',
  'ลำปาง',
  'ลำพูน',
  'เลย',
  'ศรีสะเกษ',
  'สกลนคร',
  'สงขลา',
  'สตูล',
  'สมุทรปราการ',
  'สมุทรสงคราม',
  'สมุทรสาคร',
  'สระแก้ว',
  'สระบุรี',
  'สิงห์บุรี',
  'สุโขทัย',
  'สุพรรณบุรี',
  'สุราษฎร์ธานี',
  'สุรินทร์',
  'หนองคาย',
  'หนองบัวลำภู',
  'อ่างทอง',
  'อำนาจเจริญ',
  'อุดรธานี',
  'อุตรดิตถ์',
  'อุทัยธานี',
  'อุบลราชธานี',
];

/* ───────────────────────── พัสดุ (Shipment) ───────────────────────── */

export type ShipmentStatusCode =
  'PENDING' | 'PREPARING' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'RETURNED';

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatusCode, string> = {
  PENDING: 'รอส่ง',
  PREPARING: 'กำลังเตรียม',
  SHIPPED: 'ส่งมอบให้ขนส่งแล้ว',
  IN_TRANSIT: 'อยู่ระหว่างขนส่ง',
  DELIVERED: 'ส่งถึงแล้ว',
  FAILED: 'ส่งไม่สำเร็จ',
  RETURNED: 'ตีกลับถึงร้านแล้ว',
};

/**
 * สถานะที่พนักงานเปลี่ยนได้จากหน้าพัสดุ
 *
 * - **"ส่งถึงแล้ว" ไม่อยู่ที่นี่โดยเจตนา** — ส่งถึง = ได้เงิน COD + ให้แต้ม + แจ้งชวนรีวิว
 *   ทำผ่านการเปลี่ยนสถานะคำสั่งซื้อเป็น DELIVERED ทางเดียว (admin-order.service) ไม่ให้มีสองทางที่ทำไม่เหมือนกัน
 * - ส่งไม่สำเร็จแล้วขนส่งนำส่งใหม่ได้ (FAILED → IN_TRANSIT) · ตีกลับถึงร้านแล้วจบ (ส่งใหม่ = พัสดุชิ้นใหม่)
 */
export const SHIPMENT_TRANSITIONS: Readonly<
  Record<ShipmentStatusCode, readonly ShipmentStatusCode[]>
> = {
  PENDING: [],
  PREPARING: [],
  SHIPPED: ['IN_TRANSIT', 'FAILED', 'RETURNED'],
  IN_TRANSIT: ['FAILED', 'RETURNED'],
  FAILED: ['IN_TRANSIT', 'RETURNED'],
  DELIVERED: [],
  RETURNED: [],
};

/** สถานะที่ต้องเขียนเหตุผลให้ลูกค้าอ่าน — ลูกค้าต้องรู้ว่าพัสดุของเขาเป็นอะไร */
export const SHIPMENT_STATUSES_NEEDING_NOTE: readonly ShipmentStatusCode[] = ['FAILED', 'RETURNED'];

/** พัสดุที่ยังอยู่กับขนส่ง — แก้เลขพัสดุ/กำหนดส่งได้ และกด "ส่งถึงแล้ว" ได้ */
export const SHIPMENT_IN_FLIGHT: readonly ShipmentStatusCode[] = [
  'SHIPPED',
  'IN_TRANSIT',
  'FAILED',
];

/**
 * สิ่งที่ทำกับคำสั่งซื้อที่ "จัดส่งแล้ว" ได้ ขึ้นกับพัสดุล่าสุด
 *
 * - พัสดุยังอยู่กับขนส่ง → กด "ส่งถึงแล้ว" ได้ · ยกเลิกไม่ได้ (ของยังไม่กลับมา จะคืนเข้าคลังไม่ได้)
 * - ตีกลับถึงร้านแล้ว → ส่งใหม่ (พัสดุชิ้นใหม่) หรือยกเลิกคำสั่งซื้อ (รับของเข้าคลัง) · กด "ส่งถึงแล้ว" ไม่ได้
 */
export function shippingOrderActions(latestStatus: ShipmentStatusCode | null): {
  canDeliver: boolean;
  canCancel: boolean;
  canReship: boolean;
} {
  const returned = latestStatus === 'RETURNED';
  // ไม่มีแถวพัสดุเลย (ข้อมูลก่อนมีระบบนี้) → คงพฤติกรรมเดิม: กดส่งถึงได้ ยกเลิกไม่ได้
  const inFlight = latestStatus === null || SHIPMENT_IN_FLIGHT.includes(latestStatus);

  return { canDeliver: inFlight, canCancel: returned, canReship: returned };
}
