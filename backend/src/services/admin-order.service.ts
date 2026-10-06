import { getPrisma, Prisma } from '@teenstyle/database';

import { toOrder, type OrderDto } from '../models/order.model.ts';
import { releaseCouponForCancelledOrder } from './coupon.service.ts';
import { refundStateForOrder, type OrderRefundStateDto } from './return.service.ts';
import { toNumber } from '../models/pricing.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type { UpdateOrderStatusInput } from '../validators/admin.validator.ts';

import { releaseReservationForOrder, restockForOrder } from './inventory.service.ts';
import {
  awardPointsForPaidOrder,
  notifyAfterAward,
  releasePointsForCancelledOrder,
  type PointsAward,
} from './loyalty.service.ts';
import {
  notifyOrderCancelled,
  notifyOrderDelivered,
  notifyOrderShipped,
  notifyPaymentSuccess,
  notifySafely,
} from './notification.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';

/**
 * จัดการคำสั่งซื้อฝั่งร้าน (STEP 13)
 *
 * กฎที่ห้ามละเมิด
 *   1. **เปลี่ยนสถานะได้เฉพาะเส้นทางที่อนุญาต** (`ALLOWED_TRANSITIONS`)
 *      กันการข้ามขั้น เช่น PENDING_PAYMENT → DELIVERED (ยังไม่ได้เงินแต่บอกว่าส่งถึงแล้ว)
 *   2. **ทุกการเปลี่ยนสถานะเขียน AdminLog** (ใคร เปลี่ยนอะไร จากอะไรเป็นอะไร) ในทรานแซกชันเดียวกัน
 *   3. **สต็อกต้องสอดคล้องกับสถานะจริง**
 *      - ยกเลิกออเดอร์ที่ยังไม่ตัดสต็อก → คืนของที่จองไว้
 *      - ยกเลิกออเดอร์ที่ตัดสต็อกแล้ว → รับของกลับเข้าคลัง (STOCK_IN + audit trail)
 *   4. **COD: เงินถือว่าได้รับเมื่อส่งถึง** — ตอนกด DELIVERED จึงตั้ง paymentStatus = PAID
 *      ก่อนหน้านั้นห้ามตั้ง PAID (จะเป็นการบอกว่าได้เงินแล้วโดยไม่จริง)
 *   5. **ส่งของต้องมีเลขพัสดุจริง** — เปลี่ยนเป็น SHIPPING ต้องระบุ carrier + trackingNumber
 *      ระบบจะสร้างแถว Shipment ให้ ไม่มีการสร้างเลขพัสดุสมมติ
 *   6. **ตั้ง REFUNDED จากฟอร์มนี้ไม่ได้** — คำสั่งซื้อเป็น REFUNDED เมื่อบันทึกการคืนเงินครบทุกชิ้น
 *      ผ่านระบบคืนสินค้า ([return.service.ts](./return.service.ts) · STEP 43) เท่านั้น
 */

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discountTotal: true,
  // แต้มและการคืนเงินของใบนี้ (STEP 42/43) — ให้หลังบ้านเห็นยอดเดียวกับที่ลูกค้าเห็น
  pointsRedeemed: true,
  pointsDiscount: true,
  pointTransactions: { select: { type: true, delta: true } },
  refundedTotal: true,
  shippingFee: true,
  total: true,
  shippingMethod: true,
  addressSnapshot: true,
  customerNote: true,
  adminNote: true,
  createdAt: true,
  paidAt: true,
  processedAt: true,
  packedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  refundedAt: true,
  trackingNumber: true,
  user: { select: { id: true, name: true, email: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      variantId: true,
      productName: true,
      variantSku: true,
      colorName: true,
      sizeName: true,
      imageUrl: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      product: { select: { id: true, slug: true } },
    },
  },
  shipments: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      status: true,
      estimatedDelivery: true,
      shippedAt: true,
      deliveredAt: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    select: { provider: true, status: true, amount: true, paidAt: true, failureReason: true },
  },
} as const satisfies Prisma.OrderSelect;

type AdminOrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

export interface AdminOrderDto extends OrderDto {
  adminNote: string | null;
  customer: { id: string; name: string | null; email: string } | null;
  payments: {
    provider: string;
    status: string;
    amount: number;
    paidAt: string | null;
    failureReason: string | null;
  }[];
  /** สถานะที่เปลี่ยนไปได้จากสถานะปัจจุบัน (ให้ UI แสดงเฉพาะปุ่มที่ทำได้จริง) */
  allowedNextStatuses: string[];
}

/** เส้นทางสถานะที่อนุญาต — นอกเหนือจากนี้ถูกปฏิเสธที่ server */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING_PAYMENT: ['CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKING', 'CANCELLED'],
  PACKING: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

function toAdminOrder(order: AdminOrderRow): AdminOrderDto {
  return {
    ...toOrder(order),
    adminNote: order.adminNote,
    customer: order.user
      ? { id: order.user.id, name: order.user.name, email: order.user.email }
      : null,
    payments: order.payments.map((payment) => ({
      provider: payment.provider,
      status: payment.status,
      amount: Number(String(payment.amount)),
      paidAt: payment.paidAt?.toISOString() ?? null,
      failureReason: payment.failureReason,
    })),
    allowedNextStatuses: [...(ALLOWED_TRANSITIONS[order.status] ?? [])],
  };
}

export interface AdminOrderListResult {
  items: AdminOrderDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: string; count: number }[];
}

/**
 * ค้นหาคำสั่งซื้อจากเลขออเดอร์ หรือชื่อ/อีเมลของลูกค้า — คืน id ของหน้าที่ขอ + จำนวนรวม (STEP 34)
 *
 * ⚠️ ทำไมต้องเป็น raw SQL และต้องเป็น UNION
 *    เดิมเขียนเป็น `OR` ของ Prisma สามขา (เลขออเดอร์ · อีเมล · ชื่อ) ซึ่งกลายเป็น
 *    `WHERE o.orderNumber ILIKE … OR u.email ILIKE … OR u.name ILIKE …` **ข้ามสองตาราง**
 *    PostgreSQL ใช้ index กับ OR แบบข้ามตารางไม่ได้เลย ต้อง join ทั้งสองตารางให้ครบก่อน
 *    แล้วค่อยกรอง → สแกน Order 60,000 แถว + User 20,000 แถว **สองรอบ** (count + findMany)
 *    วัดแล้ว: ค้นเลขออเดอร์ 267ms · ค้นชื่อลูกค้าไทย 411ms
 *
 *    แยกเป็น UNION ของสองขา ขาละตารางเดียว → ทั้งสองขาใช้ index trigram ได้
 *    (เพิ่มใน migration 20260926171404) วัดแล้ว: 4.2ms และ 25ms
 *
 * ⚠️ แบ่งหน้าและนับจำนวน **ในคิวรีเดียวกัน** (`count(*) OVER ()`) ไม่ใช่ดึง id ทั้งหมด
 *    มาแล้วตัดใน TypeScript — คำค้นกว้าง ๆ อย่าง "a" ตรงกับหลายหมื่นแถวได้
 *    (แพตเทิร์นเดียวกับ /shop ใน shop.service.ts)
 */
async function searchOrderIds(
  prisma: ReturnType<typeof getPrisma>,
  q: string,
  status: string | undefined,
  page: number,
  limit: number,
): Promise<{ ids: string[]; total: number }> {
  const pattern = `%${q}%`;
  const statusCondition =
    status === undefined ? Prisma.empty : Prisma.sql`AND o."status" = ${status}::"OrderStatus"`;

  const rows = await prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    WITH matched AS (
      SELECT o."id"
        FROM "Order" o
       WHERE o."deletedAt" IS NULL AND o."orderNumber" ILIKE ${pattern} ${statusCondition}
      UNION
      SELECT o."id"
        FROM "Order" o
        JOIN "User" u ON u."id" = o."userId"
       WHERE o."deletedAt" IS NULL ${statusCondition}
         AND (u."email" ILIKE ${pattern} OR u."name" ILIKE ${pattern})
    )
    SELECT o."id", count(*) OVER () AS total
      FROM "Order" o
      JOIN matched ON matched."id" = o."id"
     ORDER BY o."createdAt" DESC
     LIMIT ${limit} OFFSET ${(page - 1) * limit}
  `);

  return {
    ids: rows.map((row) => row.id),
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
  };
}

/** รายการคำสั่งซื้อทั้งร้าน (ต้องมีสิทธิ์ order:read) */
export async function listAdminOrders(query: {
  status?: string;
  q?: string;
  page: number;
  limit: number;
}): Promise<AdminOrderListResult> {
  const prisma = getPrisma();
  const searching = query.q !== undefined && query.q !== '';

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...(query.status !== undefined ? { status: query.status as Prisma.EnumOrderStatusFilter } : {}),
  };

  const countsPromise = prisma.order.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  if (searching) {
    const { ids, total } = await searchOrderIds(
      prisma,
      query.q!,
      query.status,
      query.page,
      query.limit,
    );

    const [rows, grouped] = await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : prisma.order.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'desc' },
            select: ORDER_SELECT,
          }),
      countsPromise,
    ]);

    return {
      items: rows.map(toAdminOrder),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      counts: grouped.map((row) => ({ status: String(row.status), count: row._count._all })),
    };
  }

  const [total, rows, grouped] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ORDER_SELECT,
    }),
    countsPromise,
  ]);

  return {
    items: rows.map(toAdminOrder),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    counts: grouped.map((row) => ({ status: String(row.status), count: row._count._all })),
  };
}

/** รายละเอียดคำสั่งซื้อรายใบ — มีสถานะการคืนเงินด้วย (ไม่ใส่ในหน้ารายการเพราะต้องคิวรีเพิ่มต่อใบ) */
export interface AdminOrderDetailDto extends AdminOrderDto {
  /** เงินที่คืนแล้ว · ต้องคืนอีกไหม · บันทึกการคืนเงินทุกครั้ง (STEP 43) */
  refundState: OrderRefundStateDto;
}

export async function getAdminOrder(orderNumber: string): Promise<AdminOrderDetailDto> {
  const order = await getPrisma().order.findFirst({
    where: { orderNumber, deletedAt: null },
    select: ORDER_SELECT,
  });

  if (!order) {
    throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');
  }

  return { ...toAdminOrder(order), refundState: await refundStateForOrder(order.id) };
}

/** timestamp ที่ต้องบันทึกเมื่อเข้าสถานะใหม่ */
function timestampFor(status: string): Prisma.OrderUpdateInput {
  const now = new Date();

  switch (status) {
    case 'PROCESSING':
      return { processedAt: now };
    case 'PACKING':
      return { packedAt: now };
    case 'SHIPPING':
      return { shippedAt: now };
    case 'DELIVERED':
      return { deliveredAt: now };
    case 'CANCELLED':
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * อัปเดตสถานะคำสั่งซื้อ (ร้านเป็นผู้ทำ)
 *
 * ทุกอย่างอยู่ในทรานแซกชันเดียว: ตรวจเส้นทาง → แก้สต็อก (ถ้ามีผล) → อัปเดตออเดอร์
 * → สร้าง/อัปเดต Shipment → บันทึก AdminLog
 */
export async function updateOrderStatus(
  actor: { id: string; ip?: string | undefined; userAgent?: string | undefined },
  orderNumber: string,
  input: UpdateOrderStatusInput,
): Promise<AdminOrderDetailDto> {
  const prisma = getPrisma();

  const current = await prisma.order.findFirst({
    where: { orderNumber, deletedAt: null },
    select: ORDER_SELECT,
  });

  if (!current) {
    throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');
  }

  const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];

  if (!allowed.includes(input.status)) {
    throw ApiError.conflict(
      allowed.length === 0
        ? `คำสั่งซื้อสถานะ ${current.status} เปลี่ยนสถานะต่อไม่ได้แล้ว`
        : `เปลี่ยนจาก ${current.status} เป็น ${input.status} ไม่ได้ — ทำได้เฉพาะ: ${allowed.join(', ')}`,
    );
  }

  if (
    input.status === 'SHIPPING' &&
    (input.carrier === undefined || input.trackingNumber === undefined)
  ) {
    throw ApiError.badRequest('ต้องระบุผู้ให้บริการขนส่งและเลขพัสดุจริงก่อนเปลี่ยนเป็นจัดส่งแล้ว');
  }

  /**
   * แต้มที่ให้ในทรานแซกชันนี้ (COD ได้เงินตอนส่งถึง — STEP 42) เพื่อแจ้งลูกค้าหลัง commit
   * เขียนแบบ `as` เพราะ TypeScript ไม่ติดตามการกำหนดค่าใน callback แล้วจะถือว่ายังเป็น null เสมอ
   */
  let pointsAward = null as PointsAward | null;

  await prisma.$transaction(async (tx) => {
    // อ่านสถานะซ้ำในทรานแซกชัน กันพนักงานสองคนกดพร้อมกัน
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: current.id },
      select: { status: true, paymentStatus: true },
    });

    if (fresh.status !== current.status) {
      throw ApiError.conflict('สถานะคำสั่งซื้อถูกเปลี่ยนไปแล้วโดยคนอื่น — กรุณารีเฟรช');
    }

    const paymentUpdate: Prisma.OrderUpdateInput = {};

    if (input.status === 'CANCELLED') {
      /**
       * สต็อกขึ้นกับว่าตัดไปแล้วหรือยัง
       *   - ยังไม่ตัด (รอชำระเงิน) → คืนของที่จองไว้
       *   - ตัดแล้ว (จ่ายเงินแล้ว หรือ COD ที่ยืนยัน) → รับของกลับเข้าคลัง + audit trail
       */
      if (current.status === 'PENDING_PAYMENT') {
        await releaseReservationForOrder(tx, current);
        await releaseCouponForCancelledOrder(tx, current.id);
      } else {
        await restockForOrder(
          tx,
          current,
          actor.id,
          `รับคืนเข้าคลังจากการยกเลิกคำสั่งซื้อ ${current.orderNumber}`,
        );
      }

      /**
       * แต้ม (STEP 42) — ทั้งสองกรณี: คืนแต้มที่ลูกค้าใช้เป็นส่วนลด และหักแต้มที่เคยได้
       * (ใบที่จ่ายแล้วแต่ถูกยกเลิก ไม่ใช่ "เงินที่ร้านได้รับ" อีกต่อไป จึงต้องไม่เหลือแต้มค้าง)
       */
      await releasePointsForCancelledOrder(tx, current.id);

      paymentUpdate.paymentStatus = fresh.paymentStatus === 'PAID' ? 'PAID' : 'CANCELLED';

      await tx.payment.updateMany({
        where: { orderId: current.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'CANCELLED', failureReason: 'ร้านยกเลิกคำสั่งซื้อ', failedAt: new Date() },
      });
    }

    if (input.status === 'DELIVERED' && fresh.paymentStatus !== 'PAID') {
      // COD: ได้รับเงินตอนส่งถึง — บันทึกตามความจริงเมื่อพนักงานยืนยันว่าส่งถึงแล้ว
      const paidAt = new Date();
      paymentUpdate.paymentStatus = 'PAID';
      paymentUpdate.paidAt = paidAt;

      await tx.payment.updateMany({
        where: { orderId: current.id, provider: 'COD' },
        data: { status: 'PAID', paidAt, providerRef: 'เก็บเงินปลายทางเมื่อส่งถึง' },
      });
    }

    if (input.status === 'SHIPPING') {
      const shipment = await tx.shipment.create({
        data: {
          orderId: current.id,
          carrier: input.carrier!,
          method: current.shippingMethod,
          trackingNumber: input.trackingNumber!,
          trackingUrl: input.trackingUrl ?? null,
          status: 'SHIPPED',
          fee: current.shippingFee,
          shippedAt: new Date(),
          ...(input.estimatedDelivery !== undefined
            ? { estimatedDelivery: new Date(input.estimatedDelivery) }
            : {}),
        },
        select: { trackingNumber: true },
      });

      // cache เลขพัสดุไว้ที่ Order ด้วย (อัปเดตในทรานแซกชันเดียวกับต้นทาง)
      paymentUpdate.trackingNumber = shipment.trackingNumber;
    }

    if (input.status === 'DELIVERED') {
      await tx.shipment.updateMany({
        where: { orderId: current.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
    }

    await tx.order.update({
      where: { id: current.id },
      data: {
        status: input.status as Prisma.EnumOrderStatusFieldUpdateOperationsInput['set'],
        ...timestampFor(input.status),
        ...paymentUpdate,
        ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
      },
    });

    // COD: เพิ่งได้รับเงินตอนส่งถึง → ให้แต้มหลังตั้ง PAID แล้ว (ยอดสะสมนับจากออเดอร์ที่จ่ายแล้ว)
    if (paymentUpdate.paymentStatus === 'PAID' && fresh.paymentStatus !== 'PAID') {
      pointsAward = await awardPointsForPaidOrder(tx, current.id);
    }

    // audit trail: ใครเปลี่ยนอะไร เมื่อไร (หน้าดู log อยู่ที่ /admin/logs ตั้งแต่ STEP 27)
    await writeAdminLog(tx, {
      actor,
      action: 'order.status.update',
      targetType: 'Order',
      targetId: current.id,
      before: { status: current.status, paymentStatus: current.paymentStatus },
      after: {
        status: input.status,
        ...(input.trackingNumber !== undefined
          ? { carrier: input.carrier, trackingNumber: input.trackingNumber }
          : {}),
        ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
      },
    });
  });

  /**
   * ยกเลิกออเดอร์ทำให้ของกลับมาขายได้ (คืนของที่จอง หรือรับของกลับเข้าคลัง)
   * → ตรวจเตือนสต็อกหลัง commit เพื่อปิดการเตือนที่ค้างอยู่ (STEP 16)
   */
  if (input.status === 'CANCELLED') {
    await scanAlertsAfterStockChange(
      current.items.map((item) => item.variantId).filter((id): id is string => id !== null),
    );
  }

  /**
   * แจ้งลูกค้าเรื่องสถานะที่เขารู้สึกได้จริง (STEP 24)
   *
   * ⚠️ ไม่แจ้งทุกขั้น — `PROCESSING` / `PACKING` เป็นงานภายในร้าน
   *    ยิงแจ้งเตือนทุกครั้งที่พนักงานกดปุ่มจะกลายเป็น noise แล้วลูกค้าเลิกอ่านทั้งหมด
   *    (บทเรียนเดียวกับ STEP 16 ข้อ 1 เรื่องเตือนเฉพาะของที่ขายอยู่จริง)
   * ⚠️ เรียกหลังทรานแซกชัน commit และกลืน error เอง — แจ้งเตือนล้มต้องไม่ทำให้
   *    การเปลี่ยนสถานะที่บันทึกไปแล้วกลายเป็น error
   */
  const target = {
    userId: current.user.id,
    orderId: current.id,
    orderNumber: current.orderNumber,
  };

  if (
    input.status === 'SHIPPING' &&
    input.carrier !== undefined &&
    input.trackingNumber !== undefined
  ) {
    await notifySafely(
      () =>
        notifyOrderShipped(target, {
          carrier: input.carrier!,
          trackingNumber: input.trackingNumber!,
        }),
      `order:${current.id}:shipping`,
    );
  }

  if (input.status === 'DELIVERED') {
    await notifySafely(() => notifyOrderDelivered(target), `order:${current.id}:delivered`);

    /**
     * COD: กด DELIVERED = ได้รับเงินแล้ว (กฎ STEP 13 ข้อ 4)
     * ลูกค้าจึงควรได้ใบยืนยันว่าร้านรับเงินแล้วด้วย ไม่ใช่แค่ "ของถึงแล้ว"
     */
    if (current.paymentStatus !== 'PAID') {
      await notifySafely(
        () =>
          notifyPaymentSuccess(target, toNumber(current.total), {
            pointsEarned: pointsAward?.points ?? 0,
            collectedOnDelivery: true,
          }),
        `order:${current.id}:cod-paid`,
      );
    }

    await notifyAfterAward(pointsAward);
  }

  if (input.status === 'CANCELLED') {
    await notifySafely(
      () => notifyOrderCancelled(target, 'shop'),
      `order:${current.id}:cancelled-by-shop`,
    );
  }

  return getAdminOrder(orderNumber);
}
