import { Prisma } from '@teenstyle/database';

import { STORE_TIME_ZONE } from '../config/store.ts';

/**
 * เครื่องมือของรายงาน (STEP 26)
 *
 * ทั้งไฟล์นี้มีอยู่เพื่อกันความผิดพลาดสองอย่างที่ทำให้รายงานโกหกโดยไม่มีอะไรฟ้อง
 *
 *   1. **ตัดวันผิดโซนเวลา** — PostgreSQL `date_trunc` ทำงานบน UTC
 *      ยอดขายของร้านไทยช่วงเที่ยงคืนถึงเจ็ดโมงเช้าจะไปกองอยู่ใน "เมื่อวาน" ทุกวัน
 *   2. **ช่วงที่ไม่มีคำสั่งซื้อหายไปจากกราฟ** — `GROUP BY` คืนเฉพาะช่วงที่มีแถว
 *      กราฟที่ข้ามวันที่ยอดเป็นศูนย์จะดูเหมือนขายได้ต่อเนื่อง ทั้งที่จริงคือวันนั้นขายไม่ได้เลย
 */

/** ความละเอียดของแกนเวลา — ต้องตรงกับหน่วยที่ `date_trunc` ของ PostgreSQL รู้จัก */
export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/* ────────────────────────── โซนเวลาฝั่ง TypeScript ────────────────────────── */

/**
 * ระยะห่างจาก UTC ของโซนเวลาหนึ่ง ณ เวลาที่กำหนด (มิลลิวินาที)
 *
 * คำนวณจาก `Intl` ไม่ใช่ค่าคงที่ เพราะ
 *   - ถ้าเปลี่ยน `STORE_TIME_ZONE` ไปโซนอื่น ค่านี้ตามทันทีโดยไม่ต้องแก้โค้ด
 *   - โซนที่มี DST ระยะห่างไม่คงที่ตลอดปี ค่าคงที่จะเพี้ยนปีละสองครั้ง
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );

  // ปัดเศษมิลลิวินาทีทิ้ง เพราะ formatToParts ไม่คืนค่าระดับ ms
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * เวลา UTC ที่ตรงกับ "เที่ยงคืนของวันที่ระบุ ตามเวลาร้าน"
 *
 * ทำสองรอบ เพราะรอบแรกใช้ระยะห่างของโซน ณ เวลาที่เดา ซึ่งอาจอยู่คนละฝั่งของการเปลี่ยน DST
 * (ประเทศไทยไม่มี DST รอบเดียวก็พอ แต่เขียนให้ถูกไว้ก่อน เผื่อเปลี่ยนโซน)
 */
export function zonedDayStart(dateOnly: string, timeZone: string = STORE_TIME_ZONE): Date {
  const naiveUtc = new Date(`${dateOnly}T00:00:00.000Z`).getTime();

  let result = new Date(naiveUtc - zoneOffsetMs(new Date(naiveUtc), timeZone));
  result = new Date(naiveUtc - zoneOffsetMs(result, timeZone));

  return result;
}

/**
 * เวลา UTC ที่ตรงกับ "วินาทีสุดท้ายของวันที่ระบุ ตามเวลาร้าน"
 *
 * คืนเป็นจุดเริ่มของวันถัดไปลบ 1 มิลลิวินาที เพื่อให้ใช้กับ `lte` ได้โดยไม่มีช่องโหว่
 * (ถ้าใช้ `lt` กับจุดเริ่มวันถัดไปก็ได้ผลเดียวกัน — เลือกแบบนี้เพื่อให้ `where` อ่านง่าย)
 */
export function zonedDayEnd(dateOnly: string, timeZone: string = STORE_TIME_ZONE): Date {
  const start = zonedDayStart(dateOnly, timeZone);
  const nextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const nextDayOnly = formatInZone(nextDay, timeZone);

  return new Date(zonedDayStart(nextDayOnly, timeZone).getTime() - 1);
}

/** วันที่ (YYYY-MM-DD) ของเวลาหนึ่ง เมื่อมองจากโซนเวลาของร้าน */
export function formatInZone(at: Date, timeZone: string = STORE_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** วันนี้ตามเวลาร้าน — ใช้เป็นค่าเริ่มต้นของช่วงรายงาน */
export function todayInZone(timeZone: string = STORE_TIME_ZONE): string {
  return formatInZone(new Date(), timeZone);
}

/** บวก/ลบวันบนปฏิทิน (ไม่สนใจเวลา) — ใช้สร้างช่วงเทียบและเติมจุดในกราฟ */
export function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);

  return base.toISOString().slice(0, 10);
}

/** จำนวนวันในช่วง (นับรวมทั้งวันเริ่มและวันจบ) */
export function daysBetween(from: string, to: string): number {
  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${to}T00:00:00.000Z`).getTime();

  return Math.floor((toMs - fromMs) / 86_400_000) + 1;
}

/* ────────────────────────── โซนเวลาฝั่ง SQL ────────────────────────── */

/**
 * ⚠️⚠️ อ่านก่อนแตะคิวรีเวลาใด ๆ — ข้อเท็จจริงที่ทั้งไฟล์นี้ตั้งอยู่บน
 *
 * **คอลัมน์เวลาของโปรเจกต์นี้เป็น `timestamp without time zone`**
 * (`DateTime` ของ Prisma map เป็น `timestamp(3)` บน PostgreSQL ถ้าไม่ระบุ `@db.Timestamptz`)
 * ค่าที่เก็บอยู่คือ **หน้าปัดเวลา UTC** ไม่ใช่จุดเวลาที่มีโซนติดมาด้วย
 *
 * ผลที่ตามมาสองข้อ ซึ่งทั้งคู่ผิดแบบเงียบ ๆ ถ้าทำพลาด
 *
 *   1. `col AT TIME ZONE 'Asia/Bangkok'` บนคอลัมน์แบบนี้ **แปลผิดทาง**
 *      มันแปลว่า "ถือว่าเลขนี้คือเวลาไทย แล้วแปลงเป็นจุดเวลา" ไม่ใช่สิ่งที่เราต้องการ
 *      ต้องเขียนสองทอด: `col AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'`
 *      (ทอดแรกติดโซนให้ว่าเลขนี้คือ UTC · ทอดสองแปลงไปเป็นหน้าปัดเวลาไทย)
 *
 *   2. เทียบกับค่าที่ผูกเข้ามา ต้องผูกเป็น **`::timestamp` (ไม่มีโซน)** ด้วยหน้าปัด UTC
 *      ถ้าผูกเป็น `::timestamptz` PostgreSQL จะแปลงคอลัมน์ด้วย `TimeZone` ของ session
 *      แล้วผลลัพธ์จะเลื่อนไปตามโซนเวลาของเครื่องที่รัน
 *      **บนเซิร์ฟเวอร์ที่ TimeZone เป็น UTC โค้ดแบบผิดจะให้ผลถูก** บั๊กจึงผ่าน CI
 *      แล้วไปโผล่ตอน deploy (เจอจริงตอนเขียน STEP 26 บนเครื่องที่ตั้ง TimeZone เป็น Asia/Bangkok)
 *
 * และ **ห้ามใส่ `Date` ลงใน `$queryRaw` ตรง ๆ** เพราะ Prisma ผูกชนิดให้ไม่ตรง
 * ให้ผ่าน `utcTs()` เสมอ · ส่วนคิวรีที่ผ่าน Prisma แบบมี type (`aggregate` / `findMany`)
 * ไม่มีปัญหานี้ เพราะ Prisma จัดการชนิดให้เอง
 *
 * 👉 ถ้าวันหนึ่งเปลี่ยน schema ไปใช้ `@db.Timestamptz` ต้องกลับมาแก้ทั้งสองจุดนี้พร้อมกัน
 */
export function utcTs(at: Date): Prisma.Sql {
  // ตัด "Z" ทิ้ง เพื่อให้เป็นหน้าปัดเวลาเปล่า ๆ ตรงกับสิ่งที่คอลัมน์เก็บไว้จริง
  return Prisma.sql`${at.toISOString().slice(0, 23)}::timestamp`;
}

/**
 * นิพจน์ "ป้ายช่วงเวลา" ของคอลัมน์เวลาหนึ่งคอลัมน์ — คืนเป็นข้อความ `YYYY-MM-DD`
 *
 * ⚠️ ต้องแปลงโซนเวลา **ก่อน** `date_trunc` เสมอ
 *    `date_trunc('day', "paidAt")` เปล่า ๆ ตัดตามหน้าปัด UTC ที่เก็บไว้
 *    → ยอดขายช่วง 00:00–07:00 น. ตามเวลาไทย ตกไปอยู่ "เมื่อวาน" ทุกวัน
 *
 * ⚠️ `AT TIME ZONE 'UTC'` ทอดแรกจำเป็น เพราะคอลัมน์เป็น `timestamp without time zone`
 *    (ดูคำอธิบายเต็มที่ `utcTs` ด้านบน) — ตัดออกแล้วจะแปลผิดทางทันที
 *
 * `granularity` มาจาก Zod enum จึงเป็นค่าใน whitelist เท่านั้น (ไม่มีทางเป็น SQL แปลกปลอม)
 */
export function bucketLabelSql(column: Prisma.Sql, granularity: Granularity): Prisma.Sql {
  const local = Prisma.sql`(${column} AT TIME ZONE 'UTC' AT TIME ZONE ${STORE_TIME_ZONE})`;

  switch (granularity) {
    case 'week':
      return Prisma.sql`to_char(date_trunc('week', ${local}), 'YYYY-MM-DD')`;
    case 'month':
      return Prisma.sql`to_char(date_trunc('month', ${local}), 'YYYY-MM-DD')`;
    case 'day':
    default:
      return Prisma.sql`to_char(date_trunc('day', ${local}), 'YYYY-MM-DD')`;
  }
}

/* ────────────────────────── การเติมจุดว่างในกราฟ ────────────────────────── */

/** ป้ายของช่วงที่ `date` ตกอยู่ — ต้องให้ผลตรงกับ `bucketLabelSql` ทุกกรณี */
export function bucketLabelOf(dateOnly: string, granularity: Granularity): string {
  if (granularity === 'month') return `${dateOnly.slice(0, 7)}-01`;

  if (granularity === 'week') {
    // `date_trunc('week')` ของ PostgreSQL เริ่มสัปดาห์ที่ **วันจันทร์** (ISO-8601)
    const at = new Date(`${dateOnly}T00:00:00.000Z`);
    const isoWeekday = at.getUTCDay() === 0 ? 7 : at.getUTCDay();

    return addDays(dateOnly, 1 - isoWeekday);
  }

  return dateOnly;
}

/** ป้ายของทุกช่วงในช่วงเวลา เรียงจากเก่าไปใหม่ และไม่ซ้ำ */
export function bucketsInRange(from: string, to: string, granularity: Granularity): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    const label = bucketLabelOf(cursor, granularity);
    if (seen.has(label)) continue;

    seen.add(label);
    labels.push(label);
  }

  return labels;
}

/**
 * เติมช่วงที่ไม่มีคำสั่งซื้อให้เป็น 0
 *
 * ⚠️ **ห้ามข้าม** — กราฟที่ข้ามวันยอด 0 จะดูเหมือนขายได้ต่อเนื่อง
 *    ทั้งที่ความจริงคือวันนั้นไม่มีใครซื้อเลย
 */
export function fillSeries<TRow extends { bucket: string }, TPoint>(
  from: string,
  to: string,
  granularity: Granularity,
  rows: TRow[],
  toPoint: (bucket: string, row: TRow | undefined) => TPoint,
): TPoint[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));

  return bucketsInRange(from, to, granularity).map((bucket) =>
    toPoint(bucket, byBucket.get(bucket)),
  );
}

/* ────────────────────────── การเปรียบเทียบช่วง ────────────────────────── */

/**
 * สัดส่วนการเปลี่ยนแปลงเทียบช่วงก่อนหน้า
 *
 * ⚠️ ช่วงก่อนหน้าเป็น 0 → คืน **null ไม่ใช่ 0 หรือ 100%**
 *    "จาก 0 เป็น 5,000" ไม่มีเปอร์เซ็นต์การเติบโตที่มีความหมาย
 *    ใส่ +100% หรือ +∞ คือการแต่งตัวเลขให้ดูดี (กฎ STEP 13 ข้อ 6)
 *    หน้าเว็บต้องแสดงว่า "ไม่มีข้อมูลให้เทียบ" แทน
 */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** ช่วงก่อนหน้าที่ **ยาวเท่ากัน** และจบก่อนวันเริ่มของช่วงปัจจุบันหนึ่งวัน */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to);

  return { from: addDays(from, -length), to: addDays(to, -length) };
}

/* ────────────────────────── DTO ────────────────────────── */

export interface AnalyticsRangeDto {
  from: string;
  to: string;
  granularity: Granularity;
  /** โซนเวลาที่ใช้ตัดวัน — ส่งไปให้หน้าเว็บบอกผู้ใช้ได้ว่ายึดเวลาอะไร */
  timeZone: string;
  days: number;
  comparedTo: { from: string; to: string };
}

export interface SalesPointDto {
  bucket: string;
  revenue: number;
  orders: number;
}

export interface MetricDto {
  value: number;
  previous: number;
  /** null = ช่วงก่อนหน้าเป็น 0 จึงเทียบไม่ได้ */
  changePercent: number | null;
}

export interface SalesSummaryDto {
  range: AnalyticsRangeDto;
  revenue: MetricDto;
  paidOrders: MetricDto;
  averageOrderValue: MetricDto;
  /** ลูกค้าที่มีคำสั่งซื้อที่จ่ายแล้วในช่วงนี้ (นับหัวไม่ใช่นับใบ) */
  payingCustomers: MetricDto;
  /** ยอดของออเดอร์ COD ที่ยืนยันแล้วแต่ยังไม่ได้เก็บเงิน ณ ตอนนี้ — ไม่ใช่รายได้ */
  pendingCodAmount: number;
  series: SalesPointDto[];
  generatedAt: string;
}

export interface ProductPerformanceRowDto {
  productId: string | null;
  /** ชื่อจาก snapshot ของ OrderItem — สินค้าที่ถูกลบไปแล้วก็ยังมีชื่อ */
  productName: string;
  slug: string | null;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface ProductPerformanceDto {
  range: AnalyticsRangeDto;
  items: ProductPerformanceRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** ผลรวมของ **ทั้งช่วง** ไม่ใช่แค่หน้าปัจจุบัน */
  totals: { quantity: number; revenue: number };
}

export interface CustomerRankingRowDto {
  userId: string;
  name: string | null;
  email: string;
  orders: number;
  revenue: number;
  averageOrderValue: number;
  firstOrderAt: string;
  lastOrderAt: string;
}

export interface CustomerRankingDto {
  range: AnalyticsRangeDto;
  items: CustomerRankingRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** ลูกค้าที่ซื้อซ้ำ (มากกว่า 1 ใบในช่วงนี้) — นับจากทั้งช่วง ไม่ใช่แค่หน้าปัจจุบัน */
  repeatCustomers: number;
}

export interface BreakdownRowDto {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  /** สัดส่วนของยอดในกลุ่มนี้ (ทศนิยม 1 ตำแหน่ง) */
  share: number;
}

export interface SalesBreakdownDto {
  range: AnalyticsRangeDto;
  /** ยอดสินค้า (ผลรวม OrderItem.lineTotal) — **ไม่รวมค่าจัดส่งและส่วนลดท้ายบิล** */
  byCategory: BreakdownRowDto[];
  byPaymentProvider: BreakdownRowDto[];
  byShippingMethod: BreakdownRowDto[];
  /** คำสั่งซื้อทั้งหมดที่ "สร้าง" ในช่วงนี้ แยกตามสถานะ (ไม่ใช่เฉพาะที่จ่ายแล้ว) */
  ordersByStatus: BreakdownRowDto[];
  /**
   * ยอดขายรวม (Order.total) เทียบกับยอดสินค้า (OrderItem.lineTotal)
   * ⚠️ สองค่านี้ **ไม่เท่ากันโดยธรรมชาติ** — ต่างกันที่ค่าจัดส่งลบส่วนลดท้ายบิล
   *    ส่งไปให้หน้าเว็บอธิบายผู้ใช้ ไม่ใช่ตัวเลขที่ต้องไป "แก้ให้ตรงกัน"
   */
  reconciliation: {
    orderRevenue: number;
    productRevenue: number;
    shippingFees: number;
    discounts: number;
  };
}

/** ชื่อไทยของช่องทางชำระเงิน — ค่าที่ไม่รู้จักแสดงรหัสเดิม ไม่เดาชื่อให้ */
export const PAYMENT_PROVIDER_LABEL: Readonly<Record<string, string>> = {
  COD: 'เก็บเงินปลายทาง',
  STRIPE: 'บัตรเครดิต/เดบิต (Stripe)',
  PROMPTPAY: 'พร้อมเพย์',
  BANK_TRANSFER: 'โอนผ่านธนาคาร',
  CREDIT_CARD: 'บัตรเครดิต',
};

export const SHIPPING_METHOD_LABEL: Readonly<Record<string, string>> = {
  STANDARD: 'ส่งธรรมดา',
  EXPRESS: 'ส่งด่วน',
  SAME_DAY: 'ส่งภายในวัน',
  PICKUP: 'รับที่ร้าน',
};

export const ORDER_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING_PAYMENT: 'รอชำระเงิน',
  PAID: 'ชำระแล้ว',
  PROCESSING: 'กำลังเตรียม',
  PACKING: 'กำลังแพ็ก',
  SHIPPING: 'กำลังส่ง',
  DELIVERED: 'ได้รับแล้ว',
  CANCELLED: 'ยกเลิก',
  REFUNDED: 'คืนเงินแล้ว',
};

/** คิดสัดส่วนแล้วปัดเป็นทศนิยม 1 ตำแหน่ง — ฐานเป็น 0 ให้เป็น 0 ไม่ใช่ NaN */
export function shareOf(value: number, total: number): number {
  if (total === 0) return 0;

  return Math.round((value / total) * 1000) / 10;
}
