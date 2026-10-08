import { getPrisma, type Prisma } from '@teenstyle/database';

import {
  RETURN_DETAIL_MIN_LENGTH,
  RETURN_REASONS,
  refundMethodsFor,
  type RefundMethodCode,
  type ReturnReasonRule,
} from '../config/returns.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import { toNumber } from '../models/pricing.ts';
import {
  CUSTOMER_CANCELLABLE,
  HOLDING_RETURN_STATUSES,
  OPEN_RETURN_STATUSES,
  STAFF_DECISIONS,
  buildReturnNumber,
  computeRefundAmount,
  evaluateEligibility,
  isFinalReturn,
  refundMethodLabel,
  returnableLines,
  toRefundDto,
  toReturnDto,
  type RefundDto,
  type ReturnRequestDto,
  type ReturnRow,
  type ReturnStatusCode,
} from '../models/return.model.ts';
import { effectiveReturnWindowDays } from '../models/store-settings.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  AdminReturnQuery,
  CreateReturnInput,
  DecideReturnInput,
  ReceiveReturnInput,
  RecordRefundInput,
} from '../validators/return.validator.ts';

import { restockReturnedItem } from './inventory.service.ts';
import { settlePointsForReturn } from './loyalty.service.ts';
import { notifyOrderRefunded, notifyReturnUpdate, notifySafely } from './notification.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';
import { getStoreSettings } from './store-settings.service.ts';

/**
 * คืนสินค้าและคืนเงิน (STEP 43)
 *
 * ⚠️ กฎทั้งหมด (สิทธิ์ขอคืน · คืนได้กี่ชิ้น · คืนเงินเท่าไร · แต้มเท่าไร) อยู่ที่
 *    [models/return.model.ts](../models/return.model.ts) ที่เดียว — ไฟล์นี้หาข้อมูลจริงมาป้อนแล้วบันทึกผล
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **ระบบไม่ได้โอนเงินเอง** — `Refund` คือบันทึกว่าพนักงานคืนเงินแล้วจริง (วิธีไหน เลขอ้างอิงอะไร)
 *    ยังไม่ได้ต่อ Stripe Refund API เพราะไม่มีบัญชีทดสอบให้ยืนยันกับของจริง
 *    (กฎเดียวกับ Redis ของ STEP 34: adapter ที่ทดสอบกับของจริงไม่ได้แย่กว่าการบอกความจริง)
 * 2. **ยอดเงินคำนวณที่ server เสมอ** — ลูกค้าส่งได้แค่ชิ้น/จำนวน/เหตุผล พนักงานส่งได้แค่วิธี/เลขอ้างอิง
 * 3. **บวก `Order.refundedTotal` ด้วย SQL เดียวแบบมีเงื่อนไข** (`refundedTotal + amount <= total`)
 *    กดคืนเงินพร้อมกันสองคนก็คืนเกินที่ลูกค้าจ่ายไม่ได้ · มี CHECK ของฐานข้อมูลเป็นด่านสุดท้าย
 * 4. **ทุกการเปลี่ยนสถานะตรวจสถานะเดิมใน WHERE** (`updateMany … where status = เดิม`)
 *    สองคนกดพร้อมกัน → คนที่สองได้ 409 ไม่ใช่ทำซ้ำ
 * 5. **ของคนอื่นคืน 404** (กฎ STEP 28 ข้อ 5) · ทุกการกระทำของพนักงานเขียน AdminLog ในทรานแซกชันเดียวกัน
 */

type DbClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

const RETURN_SELECT = {
  id: true,
  returnNumber: true,
  status: true,
  reason: true,
  detail: true,
  staffNote: true,
  createdAt: true,
  approvedAt: true,
  rejectedAt: true,
  receivedAt: true,
  refundedAt: true,
  cancelledAt: true,
  userId: true,
  orderId: true,
  order: { select: { orderNumber: true } },
  items: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      quantity: true,
      restocked: true,
      orderItem: {
        select: {
          id: true,
          productName: true,
          variantSku: true,
          colorName: true,
          sizeName: true,
          imageUrl: true,
          unitPrice: true,
          variantId: true,
        },
      },
    },
  },
  refund: {
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      note: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  },
} as const satisfies Prisma.ReturnRequestSelect;

type ReturnRecord = Prisma.ReturnRequestGetPayload<{ select: typeof RETURN_SELECT }>;

/* ═══════════════════════ ข้อมูลเงินของคำสั่งซื้อ ═══════════════════════ */

/** ทุกอย่างที่การคิดเงินคืนต้องรู้เกี่ยวกับคำสั่งซื้อหนึ่งใบ */
interface RefundContext {
  orderId: string;
  total: number;
  subtotal: number;
  refundedTotal: number;
  items: { id: string; quantity: number }[];
  /** ชิ้นที่ **คืนเงินไปแล้ว** จากคำขอก่อน ๆ */
  refundedItems: { orderItemId: string; quantity: number }[];
}

const CONTEXT_SELECT = {
  id: true,
  total: true,
  subtotal: true,
  refundedTotal: true,
  items: { select: { id: true, quantity: true } },
  returnRequests: {
    where: { status: 'REFUNDED' },
    select: { items: { select: { orderItemId: true, quantity: true } } },
  },
} as const satisfies Prisma.OrderSelect;

function toContext(
  order: Prisma.OrderGetPayload<{ select: typeof CONTEXT_SELECT }>,
): RefundContext {
  return {
    orderId: order.id,
    total: toNumber(order.total),
    subtotal: toNumber(order.subtotal),
    refundedTotal: toNumber(order.refundedTotal),
    items: order.items,
    refundedItems: order.returnRequests.flatMap((request) => request.items),
  };
}

async function contextsFor(
  client: DbClient,
  orderIds: string[],
): Promise<Map<string, RefundContext>> {
  const rows = await client.order.findMany({
    where: { id: { in: [...new Set(orderIds)] } },
    select: CONTEXT_SELECT,
  });

  return new Map(rows.map((row) => [row.id, toContext(row)]));
}

const goodsOf = (record: ReturnRecord): number =>
  record.items.reduce((sum, item) => sum + toNumber(item.orderItem.unitPrice) * item.quantity, 0);

/**
 * เงินที่คำขอนี้จะได้คืน — สูตรเดียวกับที่ใช้ตอนบันทึกการคืนเงินจริง
 * (หน้าเว็บจึงโชว์ตัวเลขเดียวกับที่ร้านจะคืน ไม่ใช่ตัวเลขประมาณที่คิดคนละทาง)
 */
function refundPlanFor(
  record: ReturnRecord,
  context: RefundContext,
): { amount: number; goods: number; final: boolean } {
  const goods = goodsOf(record);
  const final = isFinalReturn(context.items, [
    ...context.refundedItems,
    ...record.items.map((item) => ({ orderItemId: item.orderItem.id, quantity: item.quantity })),
  ]);

  return {
    goods,
    final,
    amount: computeRefundAmount({
      total: context.total,
      subtotal: context.subtotal,
      refundedTotal: context.refundedTotal,
      goods,
      final,
    }),
  };
}

function estimateFor(record: ReturnRecord, context: RefundContext | undefined): number | null {
  if (record.status === 'REJECTED' || record.status === 'CANCELLED') return null;
  if (record.refund !== null) return toNumber(record.refund.amount);
  if (context === undefined) return null;

  return refundPlanFor(record, context).amount;
}

const toRow = (record: ReturnRecord): ReturnRow => record;

/* ═══════════════════════ ฝั่งลูกค้า ═══════════════════════ */

export interface ReturnEligibilityDto {
  orderNumber: string;
  eligible: boolean;
  /** เหตุผลที่ขอคืนไม่ได้ เป็นข้อความไทย — null = ขอคืนได้ */
  message: string | null;
  /** วันสุดท้ายที่แจ้งคืนได้ (null = ยังไม่ได้รับของ) */
  deadline: string | null;
  windowDays: number;
  reasons: ReturnReasonRule[];
  detailMinLength: number;
  items: {
    orderItemId: string;
    productName: string;
    variantSku: string;
    colorName: string | null;
    sizeName: string | null;
    imageUrl: string | null;
    unitPrice: number;
    purchased: number;
    returnable: number;
  }[];
  /** คำขอคืนทั้งหมดของคำสั่งซื้อนี้ (ใหม่สุดก่อน) */
  requests: ReturnRequestDto[];
}

const ORDER_FOR_RETURN_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  status: true,
  paymentStatus: true,
  deliveredAt: true,
  returnWindowDays: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productName: true,
      variantSku: true,
      colorName: true,
      sizeName: true,
      imageUrl: true,
      unitPrice: true,
      quantity: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

async function heldItemsOf(client: DbClient, orderId: string) {
  return client.returnItem.findMany({
    where: {
      returnRequest: { orderId, status: { in: [...HOLDING_RETURN_STATUSES] } },
    },
    select: { orderItemId: true, quantity: true },
  });
}

/**
 * จำนวนวันที่แจ้งคืนได้ของใบนี้ — ค่าที่ยาวกว่าระหว่างนโยบายตอนสั่งกับนโยบายปัจจุบัน (STEP 49)
 * ร้านลดวันลงแล้วใบเดิมไม่เสียสิทธิ์ · ร้านขยายวันแล้วใบเดิมได้ด้วย (บทความประกาศค่าใหม่ให้ทุกคนอ่าน)
 */
async function windowDaysOf(client: DbClient, orderDays: number): Promise<number> {
  const { returnWindowDays } = await getStoreSettings(client);

  return effectiveReturnWindowDays(orderDays, returnWindowDays);
}

async function hasOpenRequest(client: DbClient, orderId: string): Promise<boolean> {
  const open = await client.returnRequest.count({
    where: { orderId, status: { in: [...OPEN_RETURN_STATUSES] } },
  });

  return open > 0;
}

/** ขอคืนได้ไหม + ชิ้นไหนยังคืนได้อีกกี่ชิ้น — ของคนอื่นได้ 404 */
export async function getReturnEligibility(
  userId: string,
  orderNumber: string,
): Promise<ReturnEligibilityDto> {
  const prisma = getPrisma();

  const order = await prisma.order.findFirst({
    where: { orderNumber, userId, deletedAt: null },
    select: ORDER_FOR_RETURN_SELECT,
  });

  if (!order) throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');

  const [held, open, requests, contexts] = await Promise.all([
    heldItemsOf(prisma, order.id),
    hasOpenRequest(prisma, order.id),
    prisma.returnRequest.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: RETURN_SELECT,
    }),
    contextsFor(prisma, [order.id]),
  ]);
  const windowDays = await windowDaysOf(prisma, order.returnWindowDays);

  const lines = returnableLines(order.items, held);
  const result = evaluateEligibility({
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveredAt: order.deliveredAt,
    hasOpenRequest: open,
    lines,
    windowDays,
    now: new Date(),
  });

  return {
    orderNumber: order.orderNumber,
    eligible: result.eligible,
    message: result.message,
    deadline: result.deadline?.toISOString() ?? null,
    windowDays,
    reasons: [...RETURN_REASONS],
    detailMinLength: RETURN_DETAIL_MIN_LENGTH,
    items: order.items.map((item) => ({
      orderItemId: item.id,
      productName: item.productName,
      variantSku: item.variantSku,
      colorName: item.colorName,
      sizeName: item.sizeName,
      imageUrl: item.imageUrl,
      unitPrice: toNumber(item.unitPrice),
      purchased: item.quantity,
      returnable: lines.find((line) => line.orderItemId === item.id)?.returnable ?? 0,
    })),
    requests: requests.map((request) =>
      toReturnDto(toRow(request), estimateFor(request, contexts.get(order.id))),
    ),
  };
}

export interface CreateReturnResult {
  request: ReturnRequestDto;
  /** false = คำขอซ้ำ (idempotencyKey เดิม) จึงคืนคำขอเดิม */
  created: boolean;
}

/**
 * ยื่นคำขอคืนสินค้า
 *
 * ⚠️ ตรวจทุกอย่างใหม่ในทรานแซกชันที่ **ล็อกแถวคำสั่งซื้อไว้** — สองคำขอพร้อมกันจะขอชิ้นเดียวกันซ้ำไม่ได้
 *    และมี partial unique index "คำขอที่ยังไม่จบได้ใบเดียวต่อคำสั่งซื้อ" เป็นด่านสุดท้าย
 */
export async function createReturnRequest(
  userId: string,
  input: CreateReturnInput,
): Promise<CreateReturnResult> {
  const prisma = getPrisma();

  const existing = await prisma.returnRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: RETURN_SELECT,
  });

  if (existing) {
    if (existing.userId !== userId) {
      throw ApiError.forbidden('idempotencyKey นี้ถูกใช้กับบัญชีอื่นแล้ว');
    }

    const contexts = await contextsFor(prisma, [existing.orderId]);

    return {
      request: toReturnDto(toRow(existing), estimateFor(existing, contexts.get(existing.orderId))),
      created: false,
    };
  }

  const returnId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { orderNumber: input.orderNumber, userId, deletedAt: null },
      select: ORDER_FOR_RETURN_SELECT,
    });

    if (!order) throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');

    // ล็อกแถวคำสั่งซื้อจนจบทรานแซกชัน — คำขอที่สองต้องรอแล้วเห็นคำขอแรก
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id}::uuid FOR UPDATE`;

    const [held, open] = await Promise.all([
      heldItemsOf(tx, order.id),
      hasOpenRequest(tx, order.id),
    ]);
    const lines = returnableLines(order.items, held);
    const windowDays = await windowDaysOf(tx, order.returnWindowDays);
    const eligibility = evaluateEligibility({
      status: order.status,
      paymentStatus: order.paymentStatus,
      deliveredAt: order.deliveredAt,
      hasOpenRequest: open,
      lines,
      windowDays,
      now: new Date(),
    });

    if (!eligibility.eligible) {
      throw ApiError.conflict(eligibility.message ?? 'คำสั่งซื้อนี้ขอคืนไม่ได้');
    }

    for (const requested of input.items) {
      const line = lines.find((row) => row.orderItemId === requested.orderItemId);
      const item = order.items.find((row) => row.id === requested.orderItemId);

      if (!line || !item) {
        throw ApiError.badRequest('มีรายการที่ไม่ได้อยู่ในคำสั่งซื้อนี้');
      }

      if (requested.quantity > line.returnable) {
        throw ApiError.conflict(
          `"${item.productName}" ขอคืนได้อีก ${line.returnable} ชิ้น (ซื้อ ${line.purchased} · อยู่ในคำขออื่นแล้ว ${line.held})`,
        );
      }
    }

    const sequence = (await tx.returnRequest.count({ where: { orderId: order.id } })) + 1;

    const created = await tx.returnRequest.create({
      data: {
        returnNumber: buildReturnNumber(order.orderNumber, sequence),
        orderId: order.id,
        userId,
        reason: input.reason,
        detail: input.detail,
        idempotencyKey: input.idempotencyKey,
        items: {
          createMany: {
            data: input.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
            })),
          },
        },
      },
      select: { id: true },
    });

    return created.id;
  });

  const record = await prisma.returnRequest.findUniqueOrThrow({
    where: { id: returnId },
    select: RETURN_SELECT,
  });
  const contexts = await contextsFor(prisma, [record.orderId]);

  return {
    request: toReturnDto(toRow(record), estimateFor(record, contexts.get(record.orderId))),
    created: true,
  };
}

export interface ReturnListDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** คำขอคืนของผู้ใช้คนนี้เท่านั้น — กรอง `userId` เสมอ */
export async function listMyReturns(
  userId: string,
  query: { page: number; limit: number },
): Promise<ReturnListDto<ReturnRequestDto>> {
  const prisma = getPrisma();
  const where = { userId };

  const [rows, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: RETURN_SELECT,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  const contexts = await contextsFor(
    prisma,
    rows.map((row) => row.orderId),
  );

  return {
    items: rows.map((row) => toReturnDto(toRow(row), estimateFor(row, contexts.get(row.orderId)))),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

/** ลูกค้ายกเลิกคำขอเอง — ได้จนกว่าร้านจะได้รับของ */
export async function cancelMyReturn(userId: string, returnId: string): Promise<ReturnRequestDto> {
  const prisma = getPrisma();

  const record = await prisma.returnRequest.findFirst({
    where: { id: returnId, userId },
    select: { id: true, status: true },
  });

  if (!record) throw ApiError.notFound('ไม่พบคำขอคืนนี้');

  if (!CUSTOMER_CANCELLABLE.includes(record.status as ReturnStatusCode)) {
    throw ApiError.conflict('ยกเลิกไม่ได้แล้ว — ร้านได้รับสินค้าหรือคำขอนี้จบไปแล้ว');
  }

  const updated = await prisma.returnRequest.updateMany({
    where: { id: returnId, userId, status: { in: [...CUSTOMER_CANCELLABLE] } },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  if (updated.count === 0) {
    throw ApiError.conflict('สถานะของคำขอเปลี่ยนไปแล้ว — กรุณารีเฟรช');
  }

  const fresh = await prisma.returnRequest.findUniqueOrThrow({
    where: { id: returnId },
    select: RETURN_SELECT,
  });

  return toReturnDto(toRow(fresh), null);
}

/* ═══════════════════════ หลังบ้าน ═══════════════════════ */

export interface AdminReturnDto extends ReturnRequestDto {
  customer: { id: string; name: string | null; email: string };
  orderTotal: number;
  orderRefundedTotal: number;
  /** ลูกค้าจ่ายด้วยช่องทางไหน — ใช้ตัดสินว่าคืนเงินได้วิธีไหน */
  paidWith: string | null;
  allowedDecisions: ReturnStatusCode[];
  canReceive: boolean;
  canRefund: boolean;
  refundMethods: { code: RefundMethodCode; label: string }[];
  /** พนักงานที่บันทึกการคืนเงิน — null = บัญชีถูกลบไปแล้ว หรือยังไม่คืนเงิน */
  refundRecordedBy: { id: string; name: string | null; email: string } | null;
}

async function paidWithOf(client: DbClient, orderIds: string[]): Promise<Map<string, string>> {
  const payments = await client.payment.findMany({
    where: { orderId: { in: orderIds }, status: { in: ['PAID', 'REFUNDED'] } },
    orderBy: { createdAt: 'asc' },
    select: { orderId: true, provider: true },
  });

  return new Map(payments.map((payment) => [payment.orderId, String(payment.provider)]));
}

async function toAdminDtos(client: DbClient, records: ReturnRecord[]): Promise<AdminReturnDto[]> {
  if (records.length === 0) return [];

  const orderIds = records.map((record) => record.orderId);
  const [contexts, paidWith, users] = await Promise.all([
    contextsFor(client, orderIds),
    paidWithOf(client, orderIds),
    client.user.findMany({
      where: { id: { in: [...new Set(records.map((record) => record.userId))] } },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return records.map((record) => {
    const context = contexts.get(record.orderId);
    const status = record.status as ReturnStatusCode;
    const provider = paidWith.get(record.orderId) ?? null;
    const customer = users.find((user) => user.id === record.userId)!;

    return {
      ...toReturnDto(toRow(record), estimateFor(record, context)),
      customer,
      orderTotal: context?.total ?? 0,
      orderRefundedTotal: context?.refundedTotal ?? 0,
      paidWith: provider,
      allowedDecisions: [...STAFF_DECISIONS[status]],
      canReceive: status === 'APPROVED',
      canRefund: status === 'RECEIVED',
      refundMethods: refundMethodsFor(provider).map((code) => ({
        code,
        label: refundMethodLabel(code),
      })),
      refundRecordedBy: record.refund?.createdBy ?? null,
    };
  });
}

export interface CancelledPaidOrderDto {
  orderNumber: string;
  total: number;
  refundedTotal: number;
  cancelledAt: string | null;
  customer: { id: string; name: string | null; email: string };
}

export interface AdminReturnListDto extends ReturnListDto<AdminReturnDto> {
  /** จำนวนคำขอแยกตามสถานะ — นับจากทั้งระบบ (ใช้ทำแท็บ) */
  counts: { status: string; count: number }[];
  /**
   * คำสั่งซื้อที่ร้านยกเลิก **หลังชำระเงินแล้ว** และยังไม่ได้คืนเงิน
   * ⚠️ เงินของลูกค้าค้างอยู่กับร้าน — ต้องเห็นได้ชัด ไม่งั้นไม่มีใครรู้ว่ายังติดเงินลูกค้าอยู่
   */
  cancelledAwaitingRefund: CancelledPaidOrderDto[];
  cancelledAwaitingRefundCount: number;
}

const AWAITING_REFUND_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  status: 'CANCELLED',
  paymentStatus: 'PAID',
};

export async function adminListReturns(query: AdminReturnQuery): Promise<AdminReturnListDto> {
  const prisma = getPrisma();

  const where: Prisma.ReturnRequestWhereInput = {
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.q !== undefined && query.q.length > 0
      ? {
          OR: [
            { returnNumber: { contains: query.q, mode: 'insensitive' } },
            { user: { email: { contains: query.q, mode: 'insensitive' } } },
            { user: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total, grouped, awaiting, awaitingCount] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      // คำขอที่รอคนจัดการมาก่อน แล้วเรียงเก่าไปใหม่ — ใครรอนานสุดได้คิวก่อน
      orderBy: [{ createdAt: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: RETURN_SELECT,
    }),
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.order.findMany({
      where: AWAITING_REFUND_WHERE,
      orderBy: { cancelledAt: 'asc' },
      take: 20,
      select: {
        orderNumber: true,
        total: true,
        refundedTotal: true,
        cancelledAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.order.count({ where: AWAITING_REFUND_WHERE }),
  ]);

  return {
    items: await toAdminDtos(prisma, rows),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
    counts: grouped.map((row) => ({ status: String(row.status), count: row._count._all })),
    cancelledAwaitingRefund: awaiting.map((order) => ({
      orderNumber: order.orderNumber,
      total: toNumber(order.total),
      refundedTotal: toNumber(order.refundedTotal),
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      customer: order.user,
    })),
    cancelledAwaitingRefundCount: awaitingCount,
  };
}

async function loadReturn(client: DbClient, returnId: string): Promise<ReturnRecord> {
  const record = await client.returnRequest.findUnique({
    where: { id: returnId },
    select: RETURN_SELECT,
  });

  if (!record) throw ApiError.notFound('ไม่พบคำขอคืนนี้');

  return record;
}

export async function adminGetReturn(returnId: string): Promise<AdminReturnDto> {
  const prisma = getPrisma();
  const [dto] = await toAdminDtos(prisma, [await loadReturn(prisma, returnId)]);

  return dto!;
}

/** เปลี่ยนสถานะแบบมีเงื่อนไข — สถานะถูกคนอื่นเปลี่ยนไปก่อนแล้ว → 409 */
async function transition(
  tx: Prisma.TransactionClient,
  returnId: string,
  from: ReturnStatusCode,
  data: Prisma.ReturnRequestUpdateManyMutationInput,
): Promise<void> {
  const updated = await tx.returnRequest.updateMany({
    where: { id: returnId, status: from },
    data,
  });

  if (updated.count === 0) {
    throw ApiError.conflict('สถานะของคำขอถูกเปลี่ยนไปแล้วโดยคนอื่น — กรุณารีเฟรช');
  }
}

/** อนุมัติ / ไม่รับคืน (`order:update`) — ไม่รับคืนต้องมีเหตุผลที่ลูกค้าอ่านได้ */
export async function adminDecideReturn(
  actor: AdminLogActor & { id: string },
  returnId: string,
  input: DecideReturnInput,
): Promise<AdminReturnDto> {
  const prisma = getPrisma();
  let notice: Parameters<typeof notifyReturnUpdate>[0] | null = null;

  await prisma.$transaction(async (tx) => {
    const record = await loadReturn(tx, returnId);
    const from = record.status as ReturnStatusCode;

    if (!STAFF_DECISIONS[from].includes(input.status)) {
      throw ApiError.conflict(
        `คำขอสถานะ ${from} เปลี่ยนเป็น ${input.status} ไม่ได้ — ทำได้: ${STAFF_DECISIONS[from].join(', ') || 'ไม่มี (จบแล้ว)'}`,
      );
    }

    const now = new Date();
    const note = input.note?.trim() || null;

    await transition(tx, returnId, from, {
      status: input.status,
      ...(input.status === 'APPROVED' ? { approvedAt: now } : { rejectedAt: now }),
      ...(note !== null ? { staffNote: note } : {}),
    });

    await writeAdminLog(tx, {
      actor,
      action: input.status === 'APPROVED' ? 'return.approve' : 'return.reject',
      targetType: 'ReturnRequest',
      targetId: returnId,
      before: { status: from, staffNote: record.staffNote },
      after: { status: input.status, staffNote: note ?? record.staffNote },
    });

    notice = {
      userId: record.userId,
      returnId,
      returnNumber: record.returnNumber,
      orderNumber: record.order.orderNumber,
      event: input.status,
      staffNote: note,
    };
  });

  const pending = notice as Parameters<typeof notifyReturnUpdate>[0] | null;
  if (pending !== null) {
    await notifySafely(() => notifyReturnUpdate(pending), `return:${returnId}:${pending.event}`);
  }

  return adminGetReturn(returnId);
}

/**
 * ตรวจรับสินค้าที่ลูกค้าส่งคืน (`order:update`)
 *
 * พนักงานตัดสินทีละชิ้นว่า **ขายต่อได้ไหม** — ได้ → รับเข้าคลัง (movement RETURN) ·
 * ชำรุด → ไม่รับเข้าคลัง (ของนั้นตัดออกจากคลังไปตั้งแต่ขายแล้ว จึงไม่ต้องแตะยอดอีก)
 * ⚠️ ต้องระบุผลของ **ทุกชิ้น** — ไม่มีค่าเริ่มต้นให้ลืมกด แล้วของชำรุดกลับเข้าไปขายต่อ
 */
export async function adminReceiveReturn(
  actor: AdminLogActor & { id: string },
  returnId: string,
  input: ReceiveReturnInput,
): Promise<AdminReturnDto> {
  const prisma = getPrisma();
  const restockedVariantIds: string[] = [];
  let notice: Parameters<typeof notifyReturnUpdate>[0] | null = null;

  await prisma.$transaction(async (tx) => {
    const record = await loadReturn(tx, returnId);

    if (record.status !== 'APPROVED') {
      throw ApiError.conflict('ตรวจรับได้เฉพาะคำขอที่อนุมัติแล้วและยังไม่ได้รับของ');
    }

    const decisions = new Map(input.items.map((item) => [item.returnItemId, item.restock]));
    const unknown = input.items.filter(
      (item) => !record.items.some((row) => row.id === item.returnItemId),
    );

    if (unknown.length > 0 || decisions.size !== record.items.length) {
      throw ApiError.badRequest('ต้องระบุผลตรวจของทุกชิ้นในคำขอนี้ ชิ้นละหนึ่งครั้ง');
    }

    let restockedCount = 0;

    for (const item of record.items) {
      if (decisions.get(item.id) !== true) continue;

      const variantId = item.orderItem.variantId;

      if (variantId === null) {
        throw ApiError.badRequest(
          `"${item.orderItem.productName}" ตัวเลือกนี้ถูกลบออกจากระบบแล้ว รับเข้าคลังไม่ได้ — เลือก "ไม่รับเข้าคลัง"`,
        );
      }

      await restockReturnedItem(tx, {
        variantId,
        quantity: item.quantity,
        returnRequestId: returnId,
        idempotencyKey: `return:${returnId}:restock:${item.id}`,
        reason: `รับคืนเข้าคลังจากคำขอคืน ${record.returnNumber}`,
        actorUserId: actor.id,
      });
      await tx.returnItem.update({ where: { id: item.id }, data: { restocked: true } });

      restockedVariantIds.push(variantId);
      restockedCount += item.quantity;
    }

    const note = input.note?.trim() || null;

    await transition(tx, returnId, 'APPROVED', {
      status: 'RECEIVED',
      receivedAt: new Date(),
      ...(note !== null ? { staffNote: note } : {}),
    });

    const totalPieces = record.items.reduce((sum, item) => sum + item.quantity, 0);

    await writeAdminLog(tx, {
      actor,
      action: 'return.receive',
      targetType: 'ReturnRequest',
      targetId: returnId,
      before: { status: 'APPROVED', restockedPieces: 0 },
      after: {
        status: 'RECEIVED',
        restockedPieces: restockedCount,
        notRestockedPieces: totalPieces - restockedCount,
      },
    });

    notice = {
      userId: record.userId,
      returnId,
      returnNumber: record.returnNumber,
      orderNumber: record.order.orderNumber,
      event: 'RECEIVED',
      staffNote: note,
    };
  });

  // ของกลับมาขายได้ → ปิดการเตือนสต็อกที่ค้างอยู่ (STEP 16)
  await scanAlertsAfterStockChange(restockedVariantIds);

  const pending = notice as Parameters<typeof notifyReturnUpdate>[0] | null;
  if (pending !== null) {
    await notifySafely(() => notifyReturnUpdate(pending), `return:${returnId}:RECEIVED`);
  }

  return adminGetReturn(returnId);
}

export interface RecordRefundResultDto<T> {
  /** false = บันทึกไปแล้วด้วย idempotencyKey เดิม จึงไม่ได้บันทึกซ้ำ */
  applied: boolean;
  result: T;
}

/**
 * บวกยอดคืนเงินของคำสั่งซื้อแบบมีเงื่อนไข + ปรับแถว Payment ตาม
 *
 * ⚠️ `::numeric(12,2)` บังคับชนิดของตัวแปร — ปล่อยให้เป็น float แล้ว 281.55 จะกลายเป็น
 *    281.55000000000001 ตอนเทียบกับคอลัมน์ numeric แล้วถูกปฏิเสธทั้งที่ยอดถูกต้อง
 */
async function addRefundToOrder(
  tx: Prisma.TransactionClient,
  params: { orderId: string; amount: number; final: boolean; now: Date },
): Promise<number> {
  const rows = await tx.$queryRaw<{ refundedTotal: string }[]>`
    UPDATE "Order"
       SET "refundedTotal" = "refundedTotal" + ${params.amount}::numeric(12, 2),
           "updatedAt" = now()
     WHERE "id" = ${params.orderId}::uuid
       AND "refundedTotal" + ${params.amount}::numeric(12, 2) <= "total"
    RETURNING "refundedTotal"::text AS "refundedTotal"`;

  if (rows.length === 0) {
    throw ApiError.conflict(
      'ยอดคืนเงินจะเกินยอดที่ลูกค้าจ่าย — อาจมีการคืนเงินไปพร้อมกันแล้ว กรุณารีเฟรช',
    );
  }

  const refundedTotal = toNumber(rows[0]!.refundedTotal);

  const payment = await tx.payment.findFirst({
    where: { orderId: params.orderId, status: { in: ['PAID', 'REFUNDED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true },
  });

  if (payment) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundAmount: Math.min(refundedTotal, toNumber(payment.amount)),
        refundedAt: params.now,
        ...(params.final ? { status: 'REFUNDED' } : {}),
      },
    });
  }

  return refundedTotal;
}

/**
 * บันทึกการคืนเงินของคำขอคืนสินค้า (`order:refund` = ADMIN ขึ้นไป)
 *
 * ยอดเงินคิดที่ server ด้วย `computeRefundAmount` — พนักงานกรอกยอดเองไม่ได้
 * คืนครบทุกชิ้นของบิลแล้ว → คำสั่งซื้อเป็น REFUNDED · แต้มคืน/หักตามสัดส่วนในทรานแซกชันเดียวกัน
 */
export async function adminRefundReturn(
  actor: AdminLogActor & { id: string },
  returnId: string,
  input: RecordRefundInput,
): Promise<RecordRefundResultDto<AdminReturnDto>> {
  const prisma = getPrisma();

  const replay = await prisma.refund.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { returnRequestId: true },
  });

  if (replay) {
    if (replay.returnRequestId !== returnId) {
      throw ApiError.conflict('idempotencyKey นี้ถูกใช้กับการคืนเงินรายการอื่นแล้ว');
    }

    return { applied: false, result: await adminGetReturn(returnId) };
  }

  let notice: Parameters<typeof notifyReturnUpdate>[0] | null = null;

  await prisma.$transaction(async (tx) => {
    const record = await loadReturn(tx, returnId);

    if (record.status !== 'RECEIVED') {
      throw ApiError.conflict('คืนเงินได้เฉพาะคำขอที่ร้านตรวจรับสินค้าแล้ว');
    }

    // ล็อกคำสั่งซื้อ — คืนเงินสองรายการของใบเดียวกันพร้อมกันต้องเห็นยอดของกันและกัน
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${record.orderId}::uuid FOR UPDATE`;

    const [contexts, paidWith] = await Promise.all([
      contextsFor(tx, [record.orderId]),
      paidWithOf(tx, [record.orderId]),
    ]);
    const context = contexts.get(record.orderId)!;
    const allowed = refundMethodsFor(paidWith.get(record.orderId) ?? null);

    if (!allowed.includes(input.method)) {
      throw ApiError.badRequest(
        `คำสั่งซื้อนี้คืนเงินด้วยวิธีนี้ไม่ได้ — ใช้ได้: ${allowed.map(refundMethodLabel).join(', ')}`,
      );
    }

    const plan = refundPlanFor(record, context);

    if (plan.amount <= 0) {
      throw ApiError.conflict('ไม่มียอดเงินให้คืนสำหรับคำขอนี้');
    }

    const now = new Date();
    const refundedTotal = await addRefundToOrder(tx, {
      orderId: record.orderId,
      amount: plan.amount,
      final: plan.final,
      now,
    });

    await tx.refund.create({
      data: {
        orderId: record.orderId,
        returnRequestId: returnId,
        amount: plan.amount,
        method: input.method,
        reference: input.reference,
        note: input.note?.trim() || null,
        createdById: actor.id,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await transition(tx, returnId, 'RECEIVED', { status: 'REFUNDED', refundedAt: now });

    if (plan.final) {
      // คืนครบทุกชิ้นแล้ว — ใบนี้ไม่ใช่เงินที่ร้านได้รับอีกต่อไป
      await tx.order.update({
        where: { id: record.orderId },
        data: { status: 'REFUNDED', paymentStatus: 'REFUNDED', refundedAt: now },
      });
    }

    const points = await settlePointsForReturn(tx, {
      orderId: record.orderId,
      returnRequestId: returnId,
      returnNumber: record.returnNumber,
      goods: plan.goods,
      subtotal: context.subtotal,
      final: plan.final,
    });

    await writeAdminLog(tx, {
      actor,
      action: 'return.refund',
      targetType: 'ReturnRequest',
      targetId: returnId,
      before: { status: 'RECEIVED', orderRefundedTotal: context.refundedTotal },
      after: {
        status: 'REFUNDED',
        orderRefundedTotal: refundedTotal,
        amount: plan.amount,
        method: input.method,
        reference: input.reference,
        pointsRefunded: points.refunded,
        pointsReversed: points.reversed,
      },
    });

    notice = {
      userId: record.userId,
      returnId,
      returnNumber: record.returnNumber,
      orderNumber: record.order.orderNumber,
      event: 'REFUNDED',
      staffNote: null,
      refundAmount: plan.amount,
    };
  });

  const pending = notice as Parameters<typeof notifyReturnUpdate>[0] | null;
  if (pending !== null) {
    await notifySafely(() => notifyReturnUpdate(pending), `return:${returnId}:REFUNDED`);
  }

  return { applied: true, result: await adminGetReturn(returnId) };
}

/* ═══════════════ คืนเงินคำสั่งซื้อที่ร้านยกเลิกหลังชำระเงิน ═══════════════ */

export interface OrderRefundStateDto {
  refundedTotal: number;
  /** ร้านยกเลิกหลังชำระเงิน และยังคืนเงินไม่ครบ — ต้องคืนเงินลูกค้า */
  awaitingRefund: boolean;
  /** ยอดที่ต้องคืน (คำนวณที่ server) — 0 = ไม่มีอะไรต้องคืน */
  refundableAmount: number;
  refundMethods: { code: RefundMethodCode; label: string }[];
  refunds: (RefundDto & {
    returnNumber: string | null;
    createdBy: { id: string; name: string | null; email: string } | null;
  })[];
}

/** สถานะการคืนเงินของคำสั่งซื้อหนึ่งใบ — ใช้ในหน้ารายละเอียดคำสั่งซื้อของหลังบ้าน */
export async function refundStateForOrder(orderId: string): Promise<OrderRefundStateDto> {
  const prisma = getPrisma();

  const [order, refunds, paidWith] = await Promise.all([
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, paymentStatus: true, total: true, refundedTotal: true },
    }),
    prisma.refund.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        note: true,
        createdAt: true,
        returnRequest: { select: { returnNumber: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
    paidWithOf(prisma, [orderId]),
  ]);

  const total = toNumber(order.total);
  const refundedTotal = toNumber(order.refundedTotal);
  const awaitingRefund = order.status === 'CANCELLED' && order.paymentStatus === 'PAID';

  return {
    refundedTotal,
    awaitingRefund,
    refundableAmount: awaitingRefund
      ? computeRefundAmount({ total, subtotal: 0, refundedTotal, goods: 0, final: true })
      : 0,
    refundMethods: refundMethodsFor(paidWith.get(orderId) ?? null).map((code) => ({
      code,
      label: refundMethodLabel(code),
    })),
    refunds: refunds.map((refund) => ({
      ...toRefundDto(refund),
      returnNumber: refund.returnRequest?.returnNumber ?? null,
      createdBy: refund.createdBy,
    })),
  };
}

/**
 * บันทึกการคืนเงินของคำสั่งซื้อที่ **ร้านยกเลิกหลังชำระเงินแล้ว** (`order:refund`)
 *
 * เดิมหลังบ้านยกเลิกใบที่จ่ายแล้วได้ (STEP 13) แต่ไม่มีที่บันทึกว่าคืนเงินแล้ว — ใบพวกนี้ค้างเป็น
 * "ยกเลิก + จ่ายแล้ว" ตลอดไป โดยไม่มีใครรู้ว่าเงินของลูกค้ากลับไปหรือยัง
 * สต็อกและแต้มถูกจัดการไปแล้วตอนยกเลิก ที่นี่จึงบันทึกเฉพาะเรื่องเงิน
 */
export async function adminRefundCancelledOrder(
  actor: AdminLogActor & { id: string },
  orderNumber: string,
  input: RecordRefundInput,
): Promise<RecordRefundResultDto<OrderRefundStateDto>> {
  const prisma = getPrisma();

  const order = await prisma.order.findFirst({
    where: { orderNumber, deletedAt: null },
    select: { id: true, userId: true, orderNumber: true },
  });

  if (!order) throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');

  const replay = await prisma.refund.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { orderId: true, returnRequestId: true },
  });

  if (replay) {
    if (replay.orderId !== order.id || replay.returnRequestId !== null) {
      throw ApiError.conflict('idempotencyKey นี้ถูกใช้กับการคืนเงินรายการอื่นแล้ว');
    }

    return { applied: false, result: await refundStateForOrder(order.id) };
  }

  let amount = 0;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${order.id}::uuid FOR UPDATE`;

    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paymentStatus: true, total: true, refundedTotal: true },
    });

    if (fresh.status !== 'CANCELLED' || fresh.paymentStatus !== 'PAID') {
      throw ApiError.conflict(
        'คืนเงินทางนี้ใช้กับคำสั่งซื้อที่ร้านยกเลิกหลังชำระเงินเท่านั้น — ใบที่ได้รับของแล้วให้คืนผ่านคำขอคืนสินค้า',
      );
    }

    const allowed = refundMethodsFor((await paidWithOf(tx, [order.id])).get(order.id) ?? null);

    if (!allowed.includes(input.method)) {
      throw ApiError.badRequest(
        `คำสั่งซื้อนี้คืนเงินด้วยวิธีนี้ไม่ได้ — ใช้ได้: ${allowed.map(refundMethodLabel).join(', ')}`,
      );
    }

    const refundedBefore = toNumber(fresh.refundedTotal);
    amount = computeRefundAmount({
      total: toNumber(fresh.total),
      subtotal: 0,
      refundedTotal: refundedBefore,
      goods: 0,
      final: true,
    });

    if (amount <= 0) throw ApiError.conflict('คำสั่งซื้อนี้คืนเงินครบแล้ว');

    const now = new Date();
    const refundedTotal = await addRefundToOrder(tx, {
      orderId: order.id,
      amount,
      final: true,
      now,
    });

    await tx.refund.create({
      data: {
        orderId: order.id,
        amount,
        method: input.method,
        reference: input.reference,
        note: input.note?.trim() || null,
        createdById: actor.id,
        idempotencyKey: input.idempotencyKey,
      },
    });

    // สถานะคำสั่งซื้อคงเป็น CANCELLED (ไทม์ไลน์บอกทั้ง "ยกเลิก" และ "คืนเงินแล้ว") · การชำระเงินเป็น REFUNDED
    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'REFUNDED', refundedAt: now },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'order.refund',
      targetType: 'Order',
      targetId: order.id,
      before: { paymentStatus: 'PAID', refundedTotal: refundedBefore },
      after: {
        paymentStatus: 'REFUNDED',
        refundedTotal,
        amount,
        method: input.method,
        reference: input.reference,
      },
    });
  });

  await notifySafely(
    () => notifyOrderRefunded({ userId: order.userId, orderId: order.id, orderNumber }, amount),
    `order:${order.id}:refunded`,
  );

  return { applied: true, result: await refundStateForOrder(order.id) };
}
