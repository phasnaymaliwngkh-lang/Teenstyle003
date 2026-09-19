import { getPrisma, Prisma } from '@teenstyle/database';

import { toOrder, type OrderDto } from '../models/order.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type { UpdateOrderStatusInput } from '../validators/admin.validator.ts';

import { releaseReservationForOrder, restockForOrder } from './inventory.service.ts';
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
 *   6. การคืนเงิน (REFUNDED) ไม่อยู่ใน STEP นี้ — ต้องทำผ่านระบบคืนเงิน (STEP 43)
 */

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discountTotal: true,
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

/** รายการคำสั่งซื้อทั้งร้าน (ต้องมีสิทธิ์ order:read) */
export async function listAdminOrders(query: {
  status?: string;
  q?: string;
  page: number;
  limit: number;
}): Promise<AdminOrderListResult> {
  const prisma = getPrisma();

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...(query.status !== undefined ? { status: query.status as Prisma.EnumOrderStatusFilter } : {}),
    ...(query.q !== undefined && query.q !== ''
      ? {
          OR: [
            { orderNumber: { contains: query.q, mode: 'insensitive' } },
            { user: { email: { contains: query.q, mode: 'insensitive' } } },
            { user: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows, grouped] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ORDER_SELECT,
    }),
    prisma.order.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
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

export async function getAdminOrder(orderNumber: string): Promise<AdminOrderDto> {
  const order = await getPrisma().order.findFirst({
    where: { orderNumber, deletedAt: null },
    select: ORDER_SELECT,
  });

  if (!order) {
    throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');
  }

  return toAdminOrder(order);
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
): Promise<AdminOrderDto> {
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
      } else {
        await restockForOrder(
          tx,
          current,
          actor.id,
          `รับคืนเข้าคลังจากการยกเลิกคำสั่งซื้อ ${current.orderNumber}`,
        );
      }

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

    // audit trail: ใครเปลี่ยนอะไร เมื่อไร (STEP 27 จะทำหน้าดู log)
    await tx.adminLog.create({
      data: {
        userId: actor.id,
        action: 'order.status.update',
        targetType: 'ORDER',
        targetId: current.id,
        before: { status: current.status, paymentStatus: current.paymentStatus },
        after: {
          status: input.status,
          ...(input.trackingNumber !== undefined
            ? { carrier: input.carrier, trackingNumber: input.trackingNumber }
            : {}),
          ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
        },
        ...(actor.ip !== undefined ? { ipAddress: actor.ip } : {}),
        ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
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

  return getAdminOrder(orderNumber);
}
