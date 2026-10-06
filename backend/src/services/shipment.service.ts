import { getPrisma, type Prisma } from '@teenstyle/database';

import { SHIPPING_METHOD_NAME, type ShippingMethodCode } from '../config/shipping.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import { shipmentStatusLabel, type ShipmentEventDto } from '../models/order.model.ts';
import {
  SHIPMENT_IN_FLIGHT,
  SHIPMENT_TRANSITIONS,
  shippingOrderActions,
  type ShipmentStatusCode,
} from '../models/shipping.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  AdminShipmentQuery,
  CreateShipmentInput,
  UpdateShipmentInput,
  UpdateShipmentStatusInput,
} from '../validators/shipping.validator.ts';

import {
  notifySafely,
  notifyShipmentProblem,
  notifyTrackingChanged,
} from './notification.service.ts';

/**
 * พัสดุ (STEP 44)
 *
 * ก่อน STEP นี้แถว `Shipment` ถูกสร้างตอนกด "จัดส่งแล้ว" แล้วไม่มีใครแตะอีกจนส่งถึง —
 * ส่งไม่สำเร็จ · ตีกลับ · กรอกเลขพัสดุผิด · ต้องส่งใหม่ ไม่มีที่บันทึกเลย
 * และใบที่พัสดุตีกลับมาก็ยกเลิกไม่ได้ (เส้นทาง SHIPPING → CANCELLED ไม่มี) ของจึงค้างในระบบ
 * ว่า "กำลังส่ง" ตลอดไปทั้งที่วางอยู่ในร้าน
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **"ส่งถึงแล้ว" มีทางเดียว** — เปลี่ยนสถานะคำสั่งซื้อเป็น DELIVERED (ได้เงิน COD + แต้ม + แจ้งชวนรีวิว)
 *    หน้าพัสดุเปลี่ยนได้แค่ อยู่ระหว่างขนส่ง · ส่งไม่สำเร็จ · ตีกลับถึงร้าน (\`SHIPMENT_TRANSITIONS\`)
 * 2. **ส่งไม่สำเร็จ/ตีกลับต้องมีเหตุผลที่ลูกค้าอ่านได้** และแจ้งลูกค้าหลัง commit
 * 3. **ทุกการเปลี่ยนเขียน \`ShipmentEvent\` (append-only) + AdminLog ในทรานแซกชันเดียวกัน**
 *    \`Shipment.status\` คือ cache ของแถวประวัติล่าสุด
 * 4. **ล็อกแถวคำสั่งซื้อก่อนตัดสิน** — แถวเดียวกับที่การเปลี่ยนสถานะคำสั่งซื้อล็อก
 *    (คนหนึ่งกด "ตีกลับ" ขณะอีกคนกด "ส่งถึงแล้ว" ต้องเรียงคิว ไม่ใช่สำเร็จทั้งคู่)
 * 5. **แก้ได้เฉพาะพัสดุชิ้นล่าสุดของใบที่ยังจัดส่งอยู่** — ชิ้นที่ตีกลับไปแล้วคือประวัติ
 */

const SHIPMENT_LIST_SELECT = {
  id: true,
  carrier: true,
  trackingNumber: true,
  trackingUrl: true,
  status: true,
  estimatedDelivery: true,
  shippedAt: true,
  deliveredAt: true,
  returnedAt: true,
  events: {
    orderBy: { sequence: 'desc' },
    take: 1,
    select: { note: true },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      shippingMethod: true,
      user: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.ShipmentSelect;

type ShipmentListRow = Prisma.ShipmentGetPayload<{ select: typeof SHIPMENT_LIST_SELECT }>;

export interface AdminShipmentListItemDto {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  statusLabel: string;
  estimatedDelivery: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  /** เลยกำหนดส่งที่ร้านกรอกไว้แล้วยังอยู่กับขนส่ง — ไม่มีกำหนดส่ง = ไม่ถือว่าเลย (ไม่เดา) */
  overdue: boolean;
  /** ข้อความล่าสุดที่ร้านเขียนถึงลูกค้า */
  latestNote: string | null;
  order: {
    orderNumber: string;
    status: string;
    shippingMethodName: string;
    customerName: string | null;
    customerEmail: string;
  };
}

function isOverdue(row: { status: string; estimatedDelivery: Date | null }, now: Date): boolean {
  return (
    row.estimatedDelivery !== null &&
    row.estimatedDelivery.getTime() < now.getTime() &&
    SHIPMENT_IN_FLIGHT.includes(row.status as ShipmentStatusCode)
  );
}

function toListItem(row: ShipmentListRow, now: Date): AdminShipmentListItemDto {
  return {
    id: row.id,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    status: row.status,
    statusLabel: shipmentStatusLabel(row.status),
    estimatedDelivery: row.estimatedDelivery?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    overdue: isOverdue(row, now),
    latestNote: row.events[0]?.note ?? null,
    order: {
      orderNumber: row.order.orderNumber,
      status: row.order.status,
      shippingMethodName: SHIPPING_METHOD_NAME[row.order.shippingMethod as ShippingMethodCode],
      customerName: row.order.user.name,
      customerEmail: row.order.user.email,
    },
  };
}

export interface AdminShipmentListDto {
  items: AdminShipmentListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** จำนวนต่อสถานะของทั้งร้าน (ไม่ขึ้นกับตัวกรอง) */
  counts: { status: string; label: string; count: number }[];
  /** พัสดุที่เลยกำหนดส่งแล้วยังอยู่กับขนส่ง — งานที่ต้องตามก่อน */
  overdueCount: number;
}

const overdueWhere = (now: Date): Prisma.ShipmentWhereInput => ({
  status: { in: [...SHIPMENT_IN_FLIGHT] },
  estimatedDelivery: { lt: now },
});

/**
 * รายการพัสดุทั้งร้าน (`shipment:read`)
 *
 * ⚠️ คำค้นตรงกับเลขคำสั่งซื้อหาก่อนจากตาราง Order (มี index trigram ตั้งแต่ STEP 34)
 *    แล้วค่อยใช้เป็น \`IN\` — ไม่เขียน OR ข้ามสองตาราง (กฎ STEP 34 ข้อ 2)
 */
export async function adminListShipments(query: AdminShipmentQuery): Promise<AdminShipmentListDto> {
  const prisma = getPrisma();
  const now = new Date();
  const conditions: Prisma.ShipmentWhereInput[] = [{ order: { deletedAt: null } }];

  if (query.status !== undefined) conditions.push({ status: query.status });
  if (query.overdue === true) conditions.push(overdueWhere(now));

  if (query.q !== undefined && query.q !== '') {
    const matchedOrders = await prisma.order.findMany({
      where: { orderNumber: { contains: query.q, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
      take: 200,
    });

    conditions.push({
      OR: [
        { trackingNumber: { contains: query.q, mode: 'insensitive' } },
        { carrier: { contains: query.q, mode: 'insensitive' } },
        { orderId: { in: matchedOrders.map((order) => order.id) } },
      ],
    });
  }

  const where: Prisma.ShipmentWhereInput = { AND: conditions };

  const [total, rows, grouped, overdueCount] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: SHIPMENT_LIST_SELECT,
    }),
    prisma.shipment.groupBy({
      by: ['status'],
      where: { order: { deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.shipment.count({ where: { AND: [{ order: { deletedAt: null } }, overdueWhere(now)] } }),
  ]);

  return {
    items: rows.map((row) => toListItem(row, now)),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    counts: grouped.map((row) => ({
      status: row.status,
      label: shipmentStatusLabel(row.status),
      count: row._count._all,
    })),
    overdueCount,
  };
}

/* ───────────────────────── รายละเอียด ───────────────────────── */

const SHIPMENT_DETAIL_SELECT = {
  ...SHIPMENT_LIST_SELECT,
  events: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      shippingMethod: true,
      addressSnapshot: true,
      user: { select: { name: true, email: true } },
      shipments: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true, status: true },
      },
    },
  },
} satisfies Prisma.ShipmentSelect;

export interface AdminShipmentDetailDto extends AdminShipmentListItemDto {
  events: (ShipmentEventDto & {
    /** ผู้บันทึก — null = บันทึกก่อนมีประวัติ หรือบัญชีถูกลบแล้ว (ห้ามใส่ชื่อปลอม) */
    recordedBy: string | null;
  })[];
  /** ชิ้นล่าสุดของคำสั่งซื้อไหม — ชิ้นเก่า (ตีกลับไปแล้ว) เป็นประวัติ แก้ไม่ได้ */
  isLatest: boolean;
  /** สถานะที่เปลี่ยนไปได้จากหน้านี้ — ว่าง = ไม่มีอะไรให้ทำ */
  allowedNextStatuses: { status: string; label: string; needsNote: boolean }[];
  /** แก้เลขพัสดุ/ขนส่ง/กำหนดส่งได้ไหม */
  canEdit: boolean;
  /** ที่อยู่ปลายทาง (snapshot ตอนสั่ง) — พนักงานใช้ติดต่อเมื่อส่งไม่สำเร็จ */
  destination: Record<string, string | null>;
  orderActions: { canDeliver: boolean; canCancel: boolean; canReship: boolean };
  paymentStatus: string;
}

function readSnapshot(value: unknown): Record<string, string | null> {
  if (typeof value !== 'object' || value === null) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, field]) => [
      key,
      typeof field === 'string' ? field : null,
    ]),
  );
}

export async function adminGetShipment(shipmentId: string): Promise<AdminShipmentDetailDto> {
  const row = await getPrisma().shipment.findUnique({
    where: { id: shipmentId },
    select: SHIPMENT_DETAIL_SELECT,
  });

  if (row === null) throw ApiError.notFound('ไม่พบพัสดุนี้');

  const now = new Date();
  const latest = row.order.shipments[0];
  const isLatest = latest?.id === row.id;
  const shipping = row.order.status === 'SHIPPING';
  const status = row.status as ShipmentStatusCode;
  const actions = shipping
    ? shippingOrderActions((latest?.status as ShipmentStatusCode | undefined) ?? null)
    : { canDeliver: false, canCancel: false, canReship: false };

  return {
    ...toListItem({ ...row, events: row.events.slice(-1) }, now),
    events: row.events.map((event) => ({
      status: event.status,
      statusLabel: shipmentStatusLabel(event.status),
      note: event.note,
      at: event.createdAt.toISOString(),
      recordedBy: event.createdBy === null ? null : (event.createdBy.name ?? event.createdBy.email),
    })),
    isLatest,
    allowedNextStatuses:
      shipping && isLatest
        ? SHIPMENT_TRANSITIONS[status].map((next) => ({
            status: next,
            label: shipmentStatusLabel(next),
            needsNote: next !== 'IN_TRANSIT',
          }))
        : [],
    canEdit: shipping && isLatest && SHIPMENT_IN_FLIGHT.includes(status),
    destination: readSnapshot(row.order.addressSnapshot),
    orderActions: actions,
    paymentStatus: row.order.paymentStatus,
  };
}

/* ───────────────────────── เปลี่ยนสถานะ ───────────────────────── */

/** ล็อกแถวคำสั่งซื้อของพัสดุชิ้นนี้ แล้วอ่านข้อมูลที่ใช้ตัดสิน (กฎข้อ 4) */
async function lockShipment(tx: Prisma.TransactionClient, shipmentId: string) {
  await tx.$queryRaw`
    SELECT o."id" FROM "Order" o
      JOIN "Shipment" s ON s."orderId" = o."id"
     WHERE s."id" = ${shipmentId}::uuid
       FOR UPDATE OF o`;

  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      status: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      estimatedDelivery: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          userId: true,
          shipments: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  if (shipment === null) throw ApiError.notFound('ไม่พบพัสดุนี้');

  if (shipment.order.status !== 'SHIPPING') {
    throw ApiError.conflict('คำสั่งซื้อนี้ไม่ได้อยู่ระหว่างจัดส่งแล้ว — แก้ข้อมูลพัสดุไม่ได้');
  }

  if (shipment.order.shipments[0]?.id !== shipment.id) {
    throw ApiError.conflict('พัสดุชิ้นนี้ไม่ใช่ชิ้นล่าสุดของคำสั่งซื้อ — แก้ได้เฉพาะชิ้นล่าสุด');
  }

  return shipment;
}

/** อยู่ระหว่างขนส่ง · ส่งไม่สำเร็จ · ตีกลับถึงร้าน (`shipment:update`) */
export async function adminUpdateShipmentStatus(
  actor: AdminLogActor & { id: string },
  shipmentId: string,
  input: UpdateShipmentStatusInput,
): Promise<AdminShipmentDetailDto> {
  const result = await getPrisma().$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);
    const from = shipment.status as ShipmentStatusCode;

    if (!SHIPMENT_TRANSITIONS[from].includes(input.status)) {
      throw ApiError.conflict(
        `เปลี่ยนพัสดุจาก "${shipmentStatusLabel(from)}" เป็น "${shipmentStatusLabel(input.status)}" ไม่ได้`,
      );
    }

    const note = input.note ?? null;
    const event = await tx.shipmentEvent.create({
      data: { shipmentId, status: input.status, note, createdById: actor.id },
      select: { id: true },
    });

    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: input.status,
        ...(input.status === 'RETURNED' ? { returnedAt: new Date() } : {}),
      },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'shipping.shipment.status',
      targetType: 'Shipment',
      targetId: shipmentId,
      before: { status: from, note: null },
      after: { status: input.status, note },
    });

    return { order: shipment.order, eventId: event.id };
  });

  if (input.status === 'FAILED' || input.status === 'RETURNED') {
    const status = input.status;

    await notifySafely(
      () =>
        notifyShipmentProblem(
          {
            userId: result.order.userId,
            orderId: result.order.id,
            orderNumber: result.order.orderNumber,
          },
          { eventId: result.eventId, status, note: input.note! },
        ),
      `shipment:${shipmentId}:${status}`,
    );
  }

  return adminGetShipment(shipmentId);
}

/* ───────────────────────── แก้ข้อมูลที่กรอกผิด ───────────────────────── */

/**
 * แก้ขนส่ง · เลขพัสดุ · ลิงก์ · กำหนดส่ง ของพัสดุที่ยังอยู่กับขนส่ง (`shipment:update`)
 * ⚠️ ต้องมีเหตุผล · เปลี่ยนเลขพัสดุแล้วแจ้งลูกค้า (เขาถือเลขเก่าอยู่) · cache ที่ Order อัปเดตตาม
 */
export async function adminUpdateShipment(
  actor: AdminLogActor,
  shipmentId: string,
  input: UpdateShipmentInput,
): Promise<AdminShipmentDetailDto> {
  const result = await getPrisma().$transaction(async (tx) => {
    const shipment = await lockShipment(tx, shipmentId);

    if (!SHIPMENT_IN_FLIGHT.includes(shipment.status as ShipmentStatusCode)) {
      throw ApiError.conflict('แก้ได้เฉพาะพัสดุที่ยังอยู่กับขนส่ง');
    }

    const current = {
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      estimatedDelivery: shipment.estimatedDelivery?.toISOString() ?? null,
    };
    const requested = {
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      estimatedDelivery:
        input.estimatedDelivery === undefined || input.estimatedDelivery === null
          ? input.estimatedDelivery
          : new Date(input.estimatedDelivery).toISOString(),
    };

    // เก็บเฉพาะช่องที่เปลี่ยนจริง — before/after จึงมีคีย์ชุดเดียวกัน (กฎ STEP 27)
    const changed = (Object.keys(requested) as (keyof typeof requested)[]).filter(
      (key) => requested[key] !== undefined && requested[key] !== current[key],
    );

    if (changed.length === 0) throw ApiError.badRequest('ข้อมูลเหมือนเดิม ไม่มีอะไรให้แก้');

    const pick = (source: Record<string, unknown>) =>
      Object.fromEntries(
        changed.map((key) => [key, source[key] ?? null]),
      ) as Prisma.InputJsonObject;

    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        ...(changed.includes('carrier') ? { carrier: input.carrier! } : {}),
        ...(changed.includes('trackingNumber') ? { trackingNumber: input.trackingNumber! } : {}),
        ...(changed.includes('trackingUrl') ? { trackingUrl: input.trackingUrl ?? null } : {}),
        ...(changed.includes('estimatedDelivery')
          ? {
              estimatedDelivery:
                input.estimatedDelivery === null ? null : new Date(input.estimatedDelivery!),
            }
          : {}),
      },
    });

    // cache เลขพัสดุที่ Order — อัปเดตในทรานแซกชันเดียวกับต้นทาง (กฎ STEP 13)
    if (changed.includes('trackingNumber')) {
      await tx.order.update({
        where: { id: shipment.order.id },
        data: { trackingNumber: input.trackingNumber! },
      });
    }

    await writeAdminLog(tx, {
      actor,
      action: 'shipping.shipment.update',
      targetType: 'Shipment',
      targetId: shipmentId,
      before: pick(current),
      after: { ...pick(requested), reason: input.reason },
    });

    return {
      order: shipment.order,
      trackingChanged: changed.includes('trackingNumber') || changed.includes('carrier'),
      carrier: input.carrier ?? shipment.carrier,
      trackingNumber: input.trackingNumber ?? shipment.trackingNumber,
    };
  });

  if (result.trackingChanged && result.trackingNumber !== null) {
    const trackingNumber = result.trackingNumber;

    await notifySafely(
      () =>
        notifyTrackingChanged(
          {
            userId: result.order.userId,
            orderId: result.order.id,
            orderNumber: result.order.orderNumber,
          },
          { shipmentId, carrier: result.carrier, trackingNumber, reason: 'CORRECTED' },
        ),
      `shipment:${shipmentId}:corrected`,
    );
  }

  return adminGetShipment(shipmentId);
}

/* ───────────────────────── ส่งใหม่ ───────────────────────── */

/**
 * ส่งพัสดุชิ้นใหม่ของคำสั่งซื้อที่พัสดุล่าสุดถูกตีกลับถึงร้านแล้ว (`shipment:update`)
 * ไม่ตัดสต็อกซ้ำ — ของชิ้นเดิมที่ตีกลับมาคือของที่ส่งออกไปใหม่ (ถูกตัดไปแล้วตอนชำระเงิน)
 */
export async function adminCreateShipment(
  actor: AdminLogActor & { id: string },
  orderNumber: string,
  input: CreateShipmentInput,
): Promise<AdminShipmentDetailDto> {
  const result = await getPrisma().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "orderNumber" = ${orderNumber} AND "deletedAt" IS NULL FOR UPDATE`;

    if (locked.length === 0) throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');

    const order = await tx.order.findUniqueOrThrow({
      where: { id: locked[0]!.id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        userId: true,
        shippingMethod: true,
        shippingFee: true,
        shipments: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { status: true },
        },
      },
    });

    const latest = (order.shipments[0]?.status as ShipmentStatusCode | undefined) ?? null;

    if (order.status !== 'SHIPPING' || !shippingOrderActions(latest).canReship) {
      throw ApiError.conflict('ส่งพัสดุใหม่ได้เมื่อพัสดุล่าสุดตีกลับถึงร้านแล้วเท่านั้น');
    }

    const shipment = await tx.shipment.create({
      data: {
        orderId: order.id,
        carrier: input.carrier,
        method: order.shippingMethod,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl ?? null,
        status: 'SHIPPED',
        // ค่าส่งของบิลเก็บไปแล้วครั้งเดียว — ชิ้นที่ส่งใหม่ไม่ได้เก็บเงินลูกค้าเพิ่ม
        fee: 0,
        shippedAt: new Date(),
        ...(input.estimatedDelivery !== undefined
          ? { estimatedDelivery: new Date(input.estimatedDelivery) }
          : {}),
        events: {
          create: { status: 'SHIPPED', note: 'ร้านส่งพัสดุให้ใหม่', createdById: actor.id },
        },
      },
      select: { id: true },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { trackingNumber: input.trackingNumber },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'shipping.shipment.create',
      targetType: 'Shipment',
      targetId: shipment.id,
      after: {
        orderNumber: order.orderNumber,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
      },
    });

    return { order, shipmentId: shipment.id };
  });

  await notifySafely(
    () =>
      notifyTrackingChanged(
        {
          userId: result.order.userId,
          orderId: result.order.id,
          orderNumber: result.order.orderNumber,
        },
        {
          shipmentId: result.shipmentId,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          reason: 'RESENT',
        },
      ),
    `shipment:${result.shipmentId}:resent`,
  );

  return adminGetShipment(result.shipmentId);
}
