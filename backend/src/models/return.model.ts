import {
  REFUND_METHOD_LABEL,
  RETURN_REASONS,
  type RefundMethodCode,
  type ReturnReasonCode,
} from '../config/returns.ts';

import { toNumber } from './pricing.ts';

/**
 * กฎของการคืนสินค้าและคืนเงิน — **แหล่งความจริงเดียว** (STEP 43)
 *
 * ทุกที่ที่ต้องรู้ว่า "คืนได้ไหม · คืนได้กี่ชิ้น · ได้เงินคืนเท่าไร · ได้แต้มคืนเท่าไร"
 * เรียกฟังก์ชันจากไฟล์นี้ — หน้าฟอร์มของลูกค้า · การสร้างคำขอ · การบันทึกการคืนเงินจริง
 * ทุกฟังก์ชันเป็นฟังก์ชันบริสุทธิ์ เทสต์ป้อนค่าเข้าได้ตรง ๆ
 *
 * ⚠️ เงินคิดเป็น **สตางค์จำนวนเต็ม** เสมอ (บทเรียนเรื่องทศนิยมลอยของ STEP 42)
 */

const toSatang = (baht: number): number => Math.round(baht * 100);
const fromSatang = (satang: number): number => satang / 100;

/* ─────────────────────────── เลขอ้างอิงของคำขอ ─────────────────────────── */

/**
 * เลขคำขอคืน = เลขคำสั่งซื้อ + ลำดับ เช่น `TS-20261006-0001-R1`
 * ลูกค้าเห็นแล้วรู้ทันทีว่าเป็นของคำสั่งซื้อไหน · ไม่ต้องมีตัวนับแยกต่อวัน
 * (รูปแบบเลขคำสั่งซื้อเองอยู่ที่ order.model.ts ที่เดียว — ไม่พิมพ์ซ้ำที่นี่)
 */
export function buildReturnNumber(orderNumber: string, sequence: number): string {
  return `${orderNumber}-R${sequence}`;
}

/* ─────────────────────────── สิทธิ์ในการขอคืน ─────────────────────────── */

export const OPEN_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'RECEIVED'] as const;

/** สถานะที่ "ยังกันชิ้นนั้นไว้" — ชิ้นที่อยู่ในคำขอเหล่านี้ขอคืนซ้ำไม่ได้ */
export const HOLDING_RETURN_STATUSES = [...OPEN_RETURN_STATUSES, 'REFUNDED'] as const;

export type ReturnIneligibility =
  'NOT_DELIVERED' | 'NOT_PAID' | 'WINDOW_CLOSED' | 'OPEN_REQUEST_EXISTS' | 'NOTHING_LEFT';

/** ข้อความที่ลูกค้าเห็น — จำนวนวันเป็นของคำสั่งซื้อใบนั้น (STEP 49 · ร้านแก้นโยบายได้) */
export function returnIneligibilityMessage(
  reason: ReturnIneligibility,
  windowDays: number,
): string {
  switch (reason) {
    case 'NOT_DELIVERED':
      return 'ขอคืนได้หลังได้รับสินค้าแล้วเท่านั้น';
    case 'NOT_PAID':
      return 'คำสั่งซื้อนี้ยังไม่มีการชำระเงินที่ร้านได้รับ จึงไม่มีเงินให้คืน';
    case 'WINDOW_CLOSED':
      return `เลยกำหนดแจ้งคืนแล้ว — คำสั่งซื้อนี้แจ้งคืนได้ภายใน ${windowDays} วันหลังได้รับสินค้า`;
    case 'OPEN_REQUEST_EXISTS':
      return 'คำสั่งซื้อนี้มีคำขอคืนที่ยังดำเนินการอยู่ — รอผลของคำขอเดิมก่อน';
    case 'NOTHING_LEFT':
      return 'ทุกชิ้นในคำสั่งซื้อนี้อยู่ในคำขอคืนแล้ว';
  }
}

/**
 * วันสุดท้ายที่แจ้งคืนได้ — นับจากเวลาที่บันทึกว่าส่งถึงจริง (ไม่เดา)
 * @param windowDays จำนวนวันของคำสั่งซื้อใบนั้น — ผู้เรียกคิดด้วย `effectiveReturnWindowDays()`
 */
export function returnDeadline(deliveredAt: Date, windowDays: number): Date {
  return new Date(deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

export interface ReturnableLine {
  orderItemId: string;
  purchased: number;
  /** ชิ้นที่อยู่ในคำขอที่ยังไม่จบ หรือคืนเงินไปแล้ว */
  held: number;
  returnable: number;
}

/** แต่ละรายการในคำสั่งซื้อยังขอคืนได้อีกกี่ชิ้น */
export function returnableLines(
  items: { id: string; quantity: number }[],
  heldItems: { orderItemId: string; quantity: number }[],
): ReturnableLine[] {
  return items.map((item) => {
    const held = heldItems
      .filter((row) => row.orderItemId === item.id)
      .reduce((sum, row) => sum + row.quantity, 0);

    return {
      orderItemId: item.id,
      purchased: item.quantity,
      held,
      returnable: Math.max(0, item.quantity - held),
    };
  });
}

export interface EligibilityInput {
  status: string;
  paymentStatus: string;
  deliveredAt: Date | null;
  hasOpenRequest: boolean;
  lines: ReturnableLine[];
  /** จำนวนวันที่แจ้งคืนได้ของใบนี้ (`effectiveReturnWindowDays` ของ snapshot กับค่าปัจจุบัน) */
  windowDays: number;
  now: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: ReturnIneligibility | null;
  message: string | null;
  deadline: Date | null;
}

/**
 * ขอคืนได้ไหม — ลำดับการตรวจคือลำดับที่ลูกค้าแก้ได้ก่อน → แก้ไม่ได้
 * ⚠️ ด่านจริงอยู่ที่ backend ตอนสร้างคำขอ ผลนี้ส่งให้หน้าเว็บซ่อน/แสดงปุ่มเท่านั้น
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const deadline =
    input.deliveredAt === null ? null : returnDeadline(input.deliveredAt, input.windowDays);
  const no = (reason: ReturnIneligibility): EligibilityResult => ({
    eligible: false,
    reason,
    message: returnIneligibilityMessage(reason, input.windowDays),
    deadline,
  });

  if (input.status !== 'DELIVERED' || input.deliveredAt === null) return no('NOT_DELIVERED');
  if (input.paymentStatus !== 'PAID') return no('NOT_PAID');
  if (deadline !== null && input.now > deadline) return no('WINDOW_CLOSED');
  if (input.hasOpenRequest) return no('OPEN_REQUEST_EXISTS');
  if (input.lines.every((line) => line.returnable === 0)) return no('NOTHING_LEFT');

  return { eligible: true, reason: null, message: null, deadline };
}

/* ─────────────────────────────── ยอดเงินคืน ─────────────────────────────── */

export interface RefundInput {
  /** ยอดที่ลูกค้าจ่ายจริงทั้งบิล (หลังหักคูปองและแต้ม รวมค่าจัดส่ง) */
  total: number;
  /** ยอดสินค้าก่อนส่วนลด */
  subtotal: number;
  /** คืนเงินไปแล้วกี่บาท */
  refundedTotal: number;
  /** มูลค่าตามราคาในบิลของชิ้นที่คืนในครั้งนี้ (unitPrice × จำนวน) */
  goods: number;
  /** ครั้งนี้ทำให้ทุกชิ้นในบิลถูกคืนครบหรือยัง */
  final: boolean;
}

/**
 * เงินที่ต้องคืนสำหรับคำขอหนึ่งครั้ง
 *
 * - คืนบางชิ้น → **ตามสัดส่วนของเงินที่จ่ายจริง** `total × goods / subtotal` (ปัดลงถึงสตางค์)
 *   ส่วนลด (คูปอง · แต้ม) และค่าส่งจึงถูกเฉลี่ยตามมูลค่าชิ้นนั้นเอง — ไม่มีทางคืนเกินที่จ่ายไป
 *   และใช้ได้กับทุกแบบของส่วนลดโดยไม่ต้องรู้ว่าคูปองเป็นชนิดไหน
 * - คืนครบทุกชิ้นแล้ว → **เงินที่เหลือทั้งหมด** `total − refundedTotal`
 *   เศษสตางค์จากการปัดลงของครั้งก่อน ๆ และค่าส่งทั้งหมดกลับไปหาลูกค้าครบในครั้งสุดท้าย
 *   (เหตุผลที่คืนได้มีแต่ความผิดของร้าน — ร้านจึงคืนค่าส่งด้วย)
 *
 * ผลรวมของทุกครั้งเท่ากับ `total` พอดีเมื่อคืนครบ และไม่มีทางเกิน (มีเทสต์สุ่มยืนยัน)
 */
export function computeRefundAmount(input: RefundInput): number {
  const total = toSatang(input.total);
  const remaining = Math.max(0, total - toSatang(input.refundedTotal));

  if (input.final) return fromSatang(remaining);

  const subtotal = toSatang(input.subtotal);
  if (subtotal <= 0) return 0;

  const share = Math.floor((total * toSatang(input.goods)) / subtotal);

  return fromSatang(Math.min(share, remaining));
}

/**
 * แต้มที่ต้องคืน/หักสำหรับคำขอหนึ่งครั้ง — สัดส่วนเดียวกับเงิน (ชิ้นที่คืน ÷ ยอดสินค้า)
 *
 * @param totalPoints แต้มทั้งหมดของบิล (ที่ใช้เป็นส่วนลด หรือที่ได้จากบิลนี้)
 * @param alreadyMoved แต้มที่คืน/หักไปแล้วจากครั้งก่อน
 */
export function computePointsShare(input: {
  totalPoints: number;
  alreadyMoved: number;
  goods: number;
  subtotal: number;
  final: boolean;
}): number {
  const remaining = Math.max(0, input.totalPoints - input.alreadyMoved);

  if (input.final) return remaining;

  const subtotal = toSatang(input.subtotal);
  if (subtotal <= 0) return 0;

  const share = Math.floor((input.totalPoints * toSatang(input.goods)) / subtotal);

  return Math.min(share, remaining);
}

/**
 * ครั้งนี้ทำให้ทุกชิ้นในบิลถูกคืนครบหรือยัง
 * @param refundedItems ชิ้นที่ **คืนเงินไปแล้ว** + ชิ้นของคำขอนี้
 */
export function isFinalReturn(
  items: { id: string; quantity: number }[],
  refundedItems: { orderItemId: string; quantity: number }[],
): boolean {
  return items.every(
    (item) =>
      refundedItems
        .filter((row) => row.orderItemId === item.id)
        .reduce((sum, row) => sum + row.quantity, 0) >= item.quantity,
  );
}

/* ─────────────────────────── เส้นทางของสถานะ ─────────────────────────── */

export type ReturnStatusCode =
  'REQUESTED' | 'APPROVED' | 'RECEIVED' | 'REFUNDED' | 'REJECTED' | 'CANCELLED';

/** ร้านเปลี่ยนได้จากหลังบ้าน — RECEIVED และ REFUNDED มี endpoint ของตัวเองเพราะต้องการข้อมูลเพิ่ม */
export const STAFF_DECISIONS: Readonly<Record<ReturnStatusCode, readonly ReturnStatusCode[]>> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['REJECTED'],
  RECEIVED: [],
  REFUNDED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** ลูกค้ายกเลิกเองได้จนกว่าร้านจะรับของ — หลังจากนั้นของอยู่ที่ร้านแล้ว */
export const CUSTOMER_CANCELLABLE: readonly ReturnStatusCode[] = ['REQUESTED', 'APPROVED'];

export const RETURN_STATUS_LABEL: Record<ReturnStatusCode, string> = {
  REQUESTED: 'รอร้านตรวจคำขอ',
  APPROVED: 'อนุมัติแล้ว — รอส่งของคืน',
  RECEIVED: 'ร้านได้รับของแล้ว — รอคืนเงิน',
  REFUNDED: 'คืนเงินแล้ว',
  REJECTED: 'ร้านไม่รับคืน',
  CANCELLED: 'ยกเลิกคำขอแล้ว',
};

/* ─────────────────────────────────── DTO ─────────────────────────────────── */

export function reasonLabel(code: string): string {
  return RETURN_REASONS.find((reason) => reason.code === code)?.label ?? code;
}

export function refundMethodLabel(code: string): string {
  return REFUND_METHOD_LABEL[code as RefundMethodCode] ?? code;
}

export interface ReturnItemDto {
  id: string;
  orderItemId: string;
  productName: string;
  variantSku: string;
  colorName: string | null;
  sizeName: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  restocked: boolean;
}

export interface RefundDto {
  id: string;
  amount: number;
  method: RefundMethodCode;
  methodLabel: string;
  reference: string;
  note: string | null;
  createdAt: string;
}

export interface ReturnRequestDto {
  id: string;
  returnNumber: string;
  orderNumber: string;
  status: ReturnStatusCode;
  statusLabel: string;
  reason: ReturnReasonCode;
  reasonLabel: string;
  detail: string;
  /** ข้อความจากร้าน — ลูกค้าเห็น */
  staffNote: string | null;
  items: ReturnItemDto[];
  /**
   * เงินที่จะได้คืนตามกฎของ `computeRefundAmount` ณ ตอนนี้
   * null = คำขอนี้ไม่ได้ไปถึงการคืนเงิน (ไม่รับคืน/ยกเลิก)
   */
  estimatedRefund: number | null;
  refund: RefundDto | null;
  canCancel: boolean;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
}

export interface ReturnRow {
  id: string;
  returnNumber: string;
  status: string;
  reason: string;
  detail: string;
  staffNote: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  receivedAt: Date | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  order: { orderNumber: string };
  items: {
    id: string;
    quantity: number;
    restocked: boolean;
    orderItem: {
      id: string;
      productName: string;
      variantSku: string;
      colorName: string | null;
      sizeName: string | null;
      imageUrl: string | null;
      unitPrice: unknown;
    };
  }[];
  refund: {
    id: string;
    amount: unknown;
    method: string;
    reference: string;
    note: string | null;
    createdAt: Date;
  } | null;
}

export function toRefundDto(refund: NonNullable<ReturnRow['refund']>): RefundDto {
  return {
    id: refund.id,
    amount: toNumber(refund.amount),
    method: refund.method as RefundMethodCode,
    methodLabel: refundMethodLabel(refund.method),
    reference: refund.reference,
    note: refund.note,
    createdAt: refund.createdAt.toISOString(),
  };
}

export function toReturnDto(row: ReturnRow, estimatedRefund: number | null): ReturnRequestDto {
  const status = row.status as ReturnStatusCode;

  return {
    id: row.id,
    returnNumber: row.returnNumber,
    orderNumber: row.order.orderNumber,
    status,
    statusLabel: RETURN_STATUS_LABEL[status] ?? row.status,
    reason: row.reason as ReturnReasonCode,
    reasonLabel: reasonLabel(row.reason),
    detail: row.detail,
    staffNote: row.staffNote,
    items: row.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItem.id,
      productName: item.orderItem.productName,
      variantSku: item.orderItem.variantSku,
      colorName: item.orderItem.colorName,
      sizeName: item.orderItem.sizeName,
      imageUrl: item.orderItem.imageUrl,
      unitPrice: toNumber(item.orderItem.unitPrice),
      quantity: item.quantity,
      restocked: item.restocked,
    })),
    estimatedRefund,
    refund: row.refund === null ? null : toRefundDto(row.refund),
    canCancel: CUSTOMER_CANCELLABLE.includes(status),
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}
