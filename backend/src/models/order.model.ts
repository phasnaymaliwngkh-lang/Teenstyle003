import type { Prisma } from '@teenstyle/database';

import { findShippingOption, type ShippingMethodCode } from '../config/shipping.ts';

import { toNumber } from './pricing.ts';

/**
 * DTO ของคำสั่งซื้อ (STEP 10)
 *
 * ทุกยอดเงินอ่านจากแถวคำสั่งซื้อในฐานข้อมูล ซึ่งถูกคำนวณตอนสร้างออเดอร์ที่ server
 * และ **ไม่เปลี่ยนตามการแก้ราคาสินค้าภายหลัง** (นี่คือเหตุผลที่ OrderItem เก็บ snapshot)
 */

/* ─────────────────── รูปแบบเลขคำสั่งซื้อ — แหล่งความจริงเดียว ─────────────────── */

/**
 * เลขคำสั่งซื้อมีรูปแบบ `TS-YYYYMMDD-####` (นับต่อวัน)
 *
 * ⚠️ **ทุกที่ที่พูดถึงหรืออ่านเลขคำสั่งซื้อต้องใช้ค่าจากไฟล์นี้** ห้ามพิมพ์รูปแบบเองซ้ำ
 *
 * เจอตอน STEP 40: ตัวสร้างเลขใช้ `TS-` แต่ฝั่ง AI Customer Service เขียนรูปแบบไว้เองเป็น
 * `ORD-` ทั้ง 5 ที่ — รวมถึง **regex ที่ใช้จับเลขจากข้อความลูกค้า** ผลคือ
 * ลูกค้าพิมพ์เลขจริง (`TS-20260918-0001`) แล้ว AI จับไม่ได้ → ตอบกลับว่า
 * "รบกวนแจ้งหมายเลขคำสั่งซื้อ (เช่น ORD-…)" แล้ววนถามซ้ำไปเรื่อย ๆ
 * → **การเช็คสถานะคำสั่งซื้อผ่านแชตไม่เคยทำงานเลย** และยังชี้ให้ลูกค้าไปหาเลขที่ไม่มีอยู่จริง
 * (ผิดกฎข้อ 3: AI ห้ามแต่งข้อมูล Order)
 */
export const ORDER_NUMBER_PREFIX = 'TS';

/** ตัวอย่างที่เอาไปโชว์ผู้ใช้ได้ — ต้องตรงรูปแบบจริงเสมอ (มีเทสต์ยืนยัน) */
export const ORDER_NUMBER_EXAMPLE = `${ORDER_NUMBER_PREFIX}-20260918-0001`;

/** ประกอบเลขคำสั่งซื้อจากวันและลำดับของวันนั้น */
export function buildOrderNumber(date: Date, sequence: number): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

  return `${ORDER_NUMBER_PREFIX}-${datePart}-${String(sequence).padStart(4, '0')}`;
}

/** prefix ของเลขทั้งหมดในวันนั้น — ใช้หาลำดับล่าสุดของวัน */
export function orderNumberPrefixFor(date: Date): string {
  return buildOrderNumber(date, 0).slice(0, -4);
}

/**
 * หาเลขคำสั่งซื้อในข้อความที่ผู้ใช้พิมพ์มา (คืน `null` ถ้าไม่มี)
 *
 * ยอมให้พิมพ์ตัวพิมพ์เล็กและเว้นวรรครอบขีดได้ เพราะคนก๊อปมาจากอีเมล/แชตบ่อย
 * แต่ **ไม่เดาให้** เมื่อรูปแบบไม่ตรง — การเดาเลขออเดอร์หมายถึงเปิดข้อมูลของคนอื่น
 */
export function findOrderNumberIn(text: string): string | null {
  const match = new RegExp(`${ORDER_NUMBER_PREFIX}\\s*-\\s*(\\d{8})\\s*-\\s*(\\d{4})`, 'i').exec(
    text,
  );

  if (match === null) return null;

  return `${ORDER_NUMBER_PREFIX}-${match[1]}-${match[2]}`;
}

/* ───────────── "ร้านได้รับเงินแล้ว" — เกณฑ์เดียวที่ทุกยอดเงินจริงใช้ ───────────── */

/**
 * คำสั่งซื้อที่นับเป็น **เงินที่ร้านได้รับจริง** — จ่ายแล้วและไม่ถูกยกเลิก/คืนเงิน
 *
 * ใช้ทั้ง "ยอดที่ได้รับ" ของลูกค้าในหลังบ้าน (STEP 25) และยอดสะสมที่ใช้ตัดสินระดับสมาชิก
 * (STEP 42) — สองตัวเลขนี้ต้องตรงกันเสมอ ไม่งั้นแอดมินเห็นยอด 12,000 แต่ลูกค้ายังเป็น Silver
 *
 * ⚠️ คิวรีแบบ raw SQL ที่ต้องใช้เกณฑ์เดียวกันอยู่ที่ `findUserIdsBySpendRange()`
 *    ใน admin-customer.service.ts — มีเทสต์เทียบผลของสองทางนี้ตรง ๆ
 */
export const PAID_ORDER_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  paymentStatus: 'PAID',
  status: { notIn: ['CANCELLED', 'REFUNDED'] },
};

export interface OrderAddressSnapshot {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface OrderItemDto {
  id: string;
  /** null = สินค้าถูกลบไปแล้ว — ยังแสดงประวัติได้จาก snapshot */
  productId: string | null;
  /** null = สินค้าถูกลบไปแล้ว — ยังแสดงประวัติได้จาก snapshot */
  productSlug: string | null;
  productName: string;
  variantSku: string;
  colorName: string | null;
  sizeName: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

/** หนึ่งขั้นในไทม์ไลน์ของคำสั่งซื้อ (STEP 12) */
export interface OrderTimelineStep {
  status: string;
  label: string;
  /** เวลาที่เกิดขึ้นจริงจากฐานข้อมูล — null = ยังไม่ถึงขั้นนี้ (ห้ามเดาเวลา) */
  at: string | null;
  done: boolean;
  current: boolean;
}

/** ข้อมูลการจัดส่งจริงจากตาราง Shipment (STEP 44 จะให้ admin สร้าง) */
export interface OrderShipmentDto {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  estimatedDelivery: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  discountTotal: number;
  /** แต้มที่ใช้เป็นส่วนลด (STEP 42) — มูลค่าเป็นบาทอยู่ใน pointsDiscount */
  pointsRedeemed: number;
  /** ส่วนหนึ่งของ discountTotal ที่มาจากแต้ม — ไม่ใช่ส่วนลดก้อนที่สอง */
  pointsDiscount: number;
  /**
   * แต้มสุทธิที่ได้จากคำสั่งซื้อนี้ (ได้ − ถูกหักคืนเมื่อยกเลิก)
   * 0 = ยังไม่ได้ (แต้มเข้าเมื่อร้านได้รับเงิน) หรือยอดไม่ถึงหนึ่งแต้ม
   */
  pointsEarned: number;
  shippingFee: number;
  total: number;
  shippingMethod: ShippingMethodCode;
  shippingMethodName: string;
  shippingEtaText: string;
  address: OrderAddressSnapshot;
  customerNote: string | null;
  items: OrderItemDto[];
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  paidAt: string | null;
  /** ไทม์ไลน์สถานะ (STEP 12) — สร้างจาก timestamp ที่บันทึกไว้จริงเท่านั้น */
  timeline: OrderTimelineStep[];
  /** เลขพัสดุล่าสุด (cache ใน Order) */
  trackingNumber: string | null;
  /** รายการจัดส่ง — ว่างได้ ถ้าร้านยังไม่สร้างใบจัดส่ง */
  shipments: OrderShipmentDto[];
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: unknown;
  discountTotal: unknown;
  /** STEP 42 — ไม่บังคับ เพื่อให้ผู้เรียกเก่ายังใช้ได้ */
  pointsRedeemed?: number;
  pointsDiscount?: unknown;
  pointTransactions?: { type: string; delta: number }[];
  shippingFee: unknown;
  total: unknown;
  shippingMethod: string;
  addressSnapshot: unknown;
  customerNote: string | null;
  createdAt: Date;
  paidAt: Date | null;
  /** timestamp ของแต่ละขั้น — ไม่บังคับ เพื่อให้ผู้เรียกเก่ายังใช้ได้ */
  processedAt?: Date | null;
  packedAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
  refundedAt?: Date | null;
  trackingNumber?: string | null;
  shipments?: {
    id: string;
    carrier: string;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
    estimatedDelivery: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  }[];
  items: {
    id: string;
    productName: string;
    variantSku: string;
    colorName: string | null;
    sizeName: string | null;
    imageUrl: string | null;
    unitPrice: unknown;
    quantity: number;
    lineTotal: unknown;
    product: { id: string; slug: string } | null;
  }[];
}

/** อ่าน snapshot ที่อยู่จาก Json อย่างปลอดภัย (ข้อมูลเก่าอาจไม่ครบทุกฟิลด์) */
function readAddress(value: unknown): OrderAddressSnapshot {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const text = (key: string): string => (typeof source[key] === 'string' ? source[key] : '');

  return {
    recipientName: text('recipientName'),
    phone: text('phone'),
    line1: text('line1'),
    line2: typeof source['line2'] === 'string' && source['line2'] !== '' ? source['line2'] : null,
    subDistrict: text('subDistrict'),
    district: text('district'),
    province: text('province'),
    postalCode: text('postalCode'),
    country: text('country') || 'TH',
  };
}

/**
 * ไทม์ไลน์ของคำสั่งซื้อ (STEP 12)
 *
 * ⚠️ ใช้ timestamp ที่บันทึกไว้จริงในฐานข้อมูลเท่านั้น — ขั้นที่ยังไม่เกิดจะเป็น `at: null`
 *    **ห้ามเดาเวลา** ว่าจะส่งถึงเมื่อไร (เวลาส่งถึงที่คาดการณ์อยู่ใน Shipment.estimatedDelivery
 *    ซึ่งร้านเป็นผู้กรอกใน STEP 44)
 *
 * ออเดอร์ที่ถูกยกเลิก/คืนเงิน จะแสดงเส้นทางที่เกิดขึ้นจริง ไม่โชว์ขั้นที่ไม่มีทางเกิดอีก
 */
function buildTimeline(order: OrderRow): OrderTimelineStep[] {
  const cancelled = order.cancelledAt ?? null;
  const refunded = order.refundedAt ?? null;

  const steps: { status: string; label: string; at: Date | null }[] = [
    { status: 'PENDING_PAYMENT', label: 'สร้างคำสั่งซื้อ', at: order.createdAt },
    { status: 'PAID', label: 'ชำระเงินแล้ว', at: order.paidAt },
    { status: 'PROCESSING', label: 'ร้านรับออเดอร์', at: order.processedAt ?? null },
    { status: 'PACKING', label: 'แพ็กสินค้า', at: order.packedAt ?? null },
    { status: 'SHIPPING', label: 'จัดส่งแล้ว', at: order.shippedAt ?? null },
    { status: 'DELIVERED', label: 'ได้รับสินค้า', at: order.deliveredAt ?? null },
  ];

  if (refunded !== null) {
    steps.push({ status: 'REFUNDED', label: 'คืนเงินแล้ว', at: refunded });
  } else if (cancelled !== null) {
    // ยกเลิกแล้ว: ตัดขั้นที่ยังไม่เกิดออก แล้วปิดท้ายด้วยการยกเลิก
    const happened = steps.filter((step) => step.at !== null);

    return [...happened, { status: 'CANCELLED', label: 'ยกเลิกคำสั่งซื้อ', at: cancelled }].map(
      (step, index, all) => ({
        status: step.status,
        label: step.label,
        at: step.at?.toISOString() ?? null,
        done: true,
        current: index === all.length - 1,
      }),
    );
  }

  const lastDoneIndex = steps.reduce((last, step, index) => (step.at !== null ? index : last), 0);

  return steps.map((step, index) => ({
    status: step.status,
    label: step.label,
    at: step.at?.toISOString() ?? null,
    done: step.at !== null,
    current: index === lastDoneIndex,
  }));
}

export function toOrder(order: OrderRow): OrderDto {
  const method = order.shippingMethod as ShippingMethodCode;
  const option = findShippingOption(method);

  const items: OrderItemDto[] = order.items.map((item) => ({
    id: item.id,
    productId: item.product?.id ?? null,
    productSlug: item.product?.slug ?? null,
    productName: item.productName,
    variantSku: item.variantSku,
    colorName: item.colorName,
    sizeName: item.sizeName,
    imageUrl: item.imageUrl,
    unitPrice: toNumber(item.unitPrice),
    quantity: item.quantity,
    lineTotal: toNumber(item.lineTotal),
  }));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotal: toNumber(order.subtotal),
    discountTotal: toNumber(order.discountTotal),
    pointsRedeemed: order.pointsRedeemed ?? 0,
    pointsDiscount: toNumber(order.pointsDiscount),
    pointsEarned: (order.pointTransactions ?? [])
      .filter((row) => row.type === 'EARN' || row.type === 'EARN_REVERSAL')
      .reduce((sum, row) => sum + row.delta, 0),
    shippingFee: toNumber(order.shippingFee),
    total: toNumber(order.total),
    shippingMethod: method,
    shippingMethodName: option.name,
    shippingEtaText: option.etaText,
    address: readAddress(order.addressSnapshot),
    customerNote: order.customerNote,
    items,
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    timeline: buildTimeline(order),
    trackingNumber: order.trackingNumber ?? null,
    shipments: (order.shipments ?? []).map((shipment) => ({
      id: shipment.id,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: shipment.status,
      estimatedDelivery: shipment.estimatedDelivery?.toISOString() ?? null,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    })),
  };
}
