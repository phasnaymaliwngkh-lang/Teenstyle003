import { findShippingOption, type ShippingMethodCode } from '../config/shipping.ts';

import { toNumber } from './pricing.ts';

/**
 * DTO ของคำสั่งซื้อ (STEP 10)
 *
 * ทุกยอดเงินอ่านจากแถวคำสั่งซื้อในฐานข้อมูล ซึ่งถูกคำนวณตอนสร้างออเดอร์ที่ server
 * และ **ไม่เปลี่ยนตามการแก้ราคาสินค้าภายหลัง** (นี่คือเหตุผลที่ OrderItem เก็บ snapshot)
 */

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
    product: { slug: string } | null;
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
