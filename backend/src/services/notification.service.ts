import { getPrisma, type Prisma } from '@teenstyle/database';

import {
  toNotificationDto,
  typesInGroup,
  type NotificationDto,
  type NotificationGroup,
  type NotificationListDto,
  type NotificationType,
} from '../models/notification.model.ts';
import { resolveProductPrice } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import { logger } from '../utils/logger.ts';

/**
 * การแจ้งเตือนของลูกค้า (STEP 24)
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **ฟีดของลูกค้ากรอง `userId = ตัวเอง` เสมอ — ห้ามอ่านแถว `userId = null`**
 *    แถวที่ไม่มีเจ้าของคือประกาศถึง *พนักงาน* (การเตือนสต็อกของ STEP 16) ซึ่งบอกยอดในคลัง
 *    และยอดที่ลูกค้าคนอื่นจองไว้ — เอาไปโชว์ลูกค้าคือการเปิดข้อมูลภายในร้าน
 * 2. **สร้างเฉพาะช่องทางที่ส่งได้จริง** — ตอนนี้คือ `IN_APP` เท่านั้น
 *    ยังไม่สร้างแถว `EMAIL` แม้ตั้งค่า SMTP แล้ว เพราะยังไม่มีตัวส่งจริง (STEP 50)
 *    แถวที่บันทึกว่า `SENT` แต่ไม่มีใครส่ง คือการโกหกตัวเอง (กฎ STEP 16 ข้อ 6)
 * 3. **การแจ้งเตือนล้มต้องไม่ทำให้งานหลักล้ม** — เรียกผ่าน `notifySafely()`
 *    หลังทรานแซกชัน commit แล้วเท่านั้น (แพตเทิร์นเดียวกับ `scanAlertsAfterStockChange`)
 * 4. **ห้ามแจ้งซ้ำเรื่องเดิม** — `notifyOnce()` เทียบกับแถวที่มีอยู่ก่อนสร้าง
 *    (webhook ของ Stripe ยิงซ้ำได้ · แอดมินกดปุ่มซ้ำได้)
 */

interface NotifyOnceInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /**
   * ค่าใน `data` ที่ต้องตรงกันทั้งหมดจึงถือว่า "เคยแจ้งเรื่องนี้ไปแล้ว"
   * เช่น `{ orderId, event: 'ORDER_CANCELLED' }`
   */
  dedupe: Record<string, string>;
}

/**
 * สร้างการแจ้งเตือนหนึ่งรายการ ถ้ายังไม่เคยแจ้งเรื่องเดียวกัน
 *
 * คืน `true` เมื่อสร้างใหม่จริง · `false` เมื่อเคยแจ้งไปแล้ว
 */
async function notifyOnce(input: NotifyOnceInput): Promise<boolean> {
  const prisma = getPrisma();

  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      AND: Object.entries(input.dedupe).map(([key, value]) => ({
        data: { path: [key], equals: value },
      })),
    },
    select: { id: true },
  });

  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      // ช่องทางเดียวที่ส่งถึงผู้ใช้ได้จริงตอนนี้ — ดูกฎข้อ 2 ด้านบน
      channel: 'IN_APP',
      // แจ้งเตือนในระบบถือว่าถึงผู้รับทันทีที่บันทึก (ต่างจากอีเมลที่ต้องรอตัวส่ง)
      status: 'SENT',
      sentAt: new Date(),
      title: input.title,
      body: input.body,
      data: input.data as Prisma.InputJsonValue,
    },
  });

  return true;
}

/**
 * เรียกงานแจ้งเตือนแบบ "ล้มได้ไม่เป็นไร"
 *
 * ⚠️ **ต้องเรียกหลังทรานแซกชันหลัก commit แล้วเท่านั้น** และห้ามโยน error ต่อ
 *    ลูกค้าสั่งซื้อสำเร็จแล้วต้องไม่เห็น error เพียงเพราะเขียนแถวแจ้งเตือนไม่ผ่าน
 */
export async function notifySafely(task: () => Promise<unknown>, context: string): Promise<void> {
  try {
    await task();
  } catch (error) {
    logger.warn({ err: error, context }, 'สร้างการแจ้งเตือนไม่สำเร็จ (ไม่กระทบงานหลัก)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// เหตุการณ์ที่แจ้งเตือน
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderNotificationTarget {
  userId: string;
  orderId: string;
  orderNumber: string;
}

/** สั่งซื้อสำเร็จ (ยังไม่จ่าย) */
export function notifyOrderCreated(
  order: OrderNotificationTarget,
  total: number,
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'ORDER_CREATED',
    title: `รับคำสั่งซื้อ ${order.orderNumber} แล้ว`,
    body: `ยอดรวม ${total.toLocaleString('th-TH')} บาท — ชำระเงินเพื่อให้ร้านเริ่มจัดของได้เลย`,
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'ORDER_CREATED' },
    dedupe: { orderId: order.orderId, event: 'ORDER_CREATED' },
  });
}

/**
 * ชำระเงินสำเร็จ
 *
 * ⚠️ **ห้ามใช้กับ COD** — เงินปลายทางยังไม่ได้รับตอนยืนยันคำสั่งซื้อ
 *    (กฎ STEP 11 ข้อ 2: ห้ามตั้ง PAID ให้ COD ก่อนได้เงิน) ใช้ `notifyCodConfirmed` แทน
 */
export function notifyPaymentSuccess(
  order: OrderNotificationTarget,
  total: number,
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'PAYMENT_SUCCESS',
    title: `ได้รับชำระเงินคำสั่งซื้อ ${order.orderNumber} แล้ว`,
    body: `ยอด ${total.toLocaleString('th-TH')} บาท — ร้านกำลังเตรียมจัดส่งให้คุณ`,
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'PAYMENT_SUCCESS' },
    dedupe: { orderId: order.orderId, event: 'PAYMENT_SUCCESS' },
  });
}

/** ยืนยันคำสั่งซื้อแบบเก็บเงินปลายทาง — ยังไม่ได้รับเงิน จึงไม่ใช่ PAYMENT_SUCCESS */
export function notifyCodConfirmed(
  order: OrderNotificationTarget,
  total: number,
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'ORDER_UPDATE',
    title: `ยืนยันคำสั่งซื้อ ${order.orderNumber} แบบเก็บเงินปลายทาง`,
    body: `ร้านเริ่มจัดของแล้ว — เตรียมเงินสด ${total.toLocaleString('th-TH')} บาท ไว้จ่ายตอนรับสินค้า`,
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'COD_CONFIRMED' },
    dedupe: { orderId: order.orderId, event: 'COD_CONFIRMED' },
  });
}

/** จ่ายเงินไม่สำเร็จ / หมดเวลาชำระเงิน */
export function notifyPaymentFailed(
  order: OrderNotificationTarget,
  reason: string,
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'PAYMENT_FAILED',
    title: `ชำระเงินคำสั่งซื้อ ${order.orderNumber} ไม่สำเร็จ`,
    body: `${reason} — สินค้าที่จองไว้ถูกคืนเข้าคลังแล้ว สั่งซื้อใหม่ได้ตามปกติ`,
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'PAYMENT_FAILED' },
    dedupe: { orderId: order.orderId, event: 'PAYMENT_FAILED' },
  });
}

/**
 * ร้านส่งของออกแล้ว
 *
 * ⚠️ เลขพัสดุมาจากที่ร้านกรอกจริงตอนเปลี่ยนสถานะ **ห้ามสร้างเลขสมมติ**
 *    (กฎ STEP 12 ข้อ 3 · STEP 13 ข้อ 2)
 */
export function notifyOrderShipped(
  order: OrderNotificationTarget,
  shipment: { carrier: string; trackingNumber: string },
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'SHIPPING',
    title: `คำสั่งซื้อ ${order.orderNumber} ออกจากร้านแล้ว`,
    body: `ส่งโดย ${shipment.carrier} เลขพัสดุ ${shipment.trackingNumber}`,
    data: {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      event: 'SHIPPING',
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
    },
    dedupe: { orderId: order.orderId, event: 'SHIPPING' },
  });
}

/** ได้รับสินค้าแล้ว — เป็นจุดที่ชวนรีวิวได้ตามกฎของ STEP 23 (รีวิวได้เมื่อได้รับของ) */
export function notifyOrderDelivered(order: OrderNotificationTarget): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'DELIVERED',
    title: `คำสั่งซื้อ ${order.orderNumber} ถึงมือคุณแล้ว`,
    body: 'ถ้าชอบหรือไม่ชอบอย่างไร เขียนรีวิวบอกคนอื่นได้จากหน้าคำสั่งซื้อนี้เลย',
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'DELIVERED' },
    dedupe: { orderId: order.orderId, event: 'DELIVERED' },
  });
}

/** ยกเลิกคำสั่งซื้อ (ลูกค้ายกเลิกเอง หรือร้านยกเลิก) */
export function notifyOrderCancelled(
  order: OrderNotificationTarget,
  by: 'customer' | 'shop',
): Promise<boolean> {
  return notifyOnce({
    userId: order.userId,
    type: 'ORDER_CANCELLED',
    title: `คำสั่งซื้อ ${order.orderNumber} ถูกยกเลิกแล้ว`,
    body:
      by === 'customer'
        ? 'คุณยกเลิกคำสั่งซื้อนี้ — สินค้าที่จองไว้ถูกคืนเข้าคลังแล้ว'
        : 'ร้านยกเลิกคำสั่งซื้อนี้ — ติดต่อฝ่ายบริการลูกค้าได้ถ้าต้องการรายละเอียดเพิ่ม',
    data: { orderId: order.orderId, orderNumber: order.orderNumber, event: 'ORDER_CANCELLED' },
    dedupe: { orderId: order.orderId, event: 'ORDER_CANCELLED' },
  });
}

/**
 * ผลการตรวจรีวิว (STEP 23 → STEP 24)
 *
 * เจ้าของรีวิวต้องรู้ว่ารีวิวของตัวเองขึ้นหน้าสินค้าแล้ว หรือถูกเอาลงเพราะอะไร
 * ไม่งั้นรีวิวที่ร้านซ่อนจะหายไปเงียบ ๆ โดยเจ้าของไม่มีทางรู้
 */
export function notifyReviewModerated(params: {
  userId: string;
  reviewId: string;
  productName: string;
  productSlug: string | null;
  status: 'APPROVED' | 'HIDDEN' | 'REJECTED';
  adminNote: string | null;
}): Promise<boolean> {
  const approved = params.status === 'APPROVED';
  const reason = params.adminNote !== null ? ` เหตุผล: ${params.adminNote}` : '';

  return notifyOnce({
    userId: params.userId,
    type: 'REVIEW_UPDATE',
    title: approved
      ? `รีวิว "${params.productName}" ของคุณขึ้นหน้าสินค้าแล้ว`
      : `รีวิว "${params.productName}" ของคุณไม่ได้แสดงบนหน้าสินค้า`,
    body: approved
      ? 'ขอบคุณที่ช่วยเล่าให้คนอื่นฟัง — รีวิวของคุณแสดงอยู่บนหน้าสินค้าแล้ว'
      : `ร้าน${params.status === 'HIDDEN' ? 'ซ่อน' : 'ไม่อนุมัติ'}รีวิวนี้${reason} — แก้ไขแล้วส่งตรวจใหม่ได้จากหน้ารีวิวของฉัน`,
    data: {
      reviewId: params.reviewId,
      productSlug: params.productSlug,
      event: `REVIEW_${params.status}`,
      status: params.status,
    },
    // แจ้งแยกตามผลการตรวจ — อนุมัติแล้วซ่อนทีหลังต้องแจ้งอีกครั้ง
    dedupe: { reviewId: params.reviewId, event: `REVIEW_${params.status}` },
  });
}

/** อ่านตัวเลขจาก `data` ของแถวเดิมอย่างปลอดภัย */
function readNumber(data: unknown, key: string): number | null {
  if (typeof data !== 'object' || data === null) return null;

  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * แจ้งเจ้าของรายการที่ถูกใจเมื่อราคาสินค้าลดลง (ปิดหนี้ของ STEP 22)
 *
 * เรียกหลังจากราคาสินค้าเปลี่ยนแล้ว (แก้สินค้าในหลังบ้าน · นำเข้าไฟล์)
 *
 * ⚠️ **แจ้งซ้ำเฉพาะเมื่อราคาลดลงกว่าครั้งที่แจ้งไปแล้ว** — ขึ้นแล้วลงกลับมาที่เดิมไม่แจ้งซ้ำ
 *    (แพตเทิร์นเดียวกับ STEP 16 ข้อ 3: แย่ลงเตือนใหม่ · ดีขึ้นไม่เตือน)
 * ⚠️ ราคาที่ใช้เทียบคิดจาก [pricing.ts](../models/pricing.ts) ที่เดียว
 *    และ `priceWhenAdded` เป็น snapshot ตอนกดถูกใจ — **ห้ามเอาไปคิดเงิน** (กฎ STEP 22 ข้อ 2)
 * ⚠️ เคารพสวิตช์ `notifyOnPriceDrop` ของลูกค้า — ปิดไว้แล้วต้องไม่แจ้ง
 */
export async function notifyWishlistPriceDrops(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;

  const prisma = getPrisma();

  const products = await prisma.product.findMany({
    // แจ้งเฉพาะของที่เปิดขายอยู่จริง — ของที่ปิดขายแล้วกดเข้าไปก็ซื้อไม่ได้
    where: { id: { in: productIds }, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true, slug: true, price: true, salePrice: true },
  });

  if (products.length === 0) return 0;

  const rows = await prisma.wishlist.findMany({
    where: { productId: { in: products.map((product) => product.id) }, notifyOnPriceDrop: true },
    select: { userId: true, productId: true, priceWhenAdded: true },
  });

  let created = 0;

  for (const product of products) {
    const currentPrice = resolveProductPrice(product).finalPrice;

    for (const row of rows.filter((item) => item.productId === product.id)) {
      const priceWhenAdded = Number(String(row.priceWhenAdded));
      if (priceWhenAdded <= 0 || currentPrice >= priceWhenAdded) continue;

      const last = await prisma.notification.findFirst({
        where: {
          userId: row.userId,
          type: 'PRICE_DROP',
          data: { path: ['productId'], equals: product.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { data: true },
      });

      // เคยแจ้งที่ราคาเท่านี้หรือถูกกว่านี้แล้ว → เงียบ
      const notifiedPrice = last === null ? null : readNumber(last.data, 'notifiedPrice');
      if (notifiedPrice !== null && notifiedPrice <= currentPrice) continue;

      const saved = priceWhenAdded - currentPrice;

      await prisma.notification.create({
        data: {
          userId: row.userId,
          type: 'PRICE_DROP',
          channel: 'IN_APP',
          status: 'SENT',
          sentAt: new Date(),
          title: `${product.name} ลดราคาแล้ว`,
          body: `เหลือ ${currentPrice.toLocaleString('th-TH')} บาท — ถูกลง ${saved.toLocaleString('th-TH')} บาท จากตอนที่คุณกดถูกใจ`,
          data: {
            productId: product.id,
            productSlug: product.slug,
            productName: product.name,
            priceWhenAdded,
            notifiedPrice: currentPrice,
            event: 'PRICE_DROP',
          } as Prisma.InputJsonValue,
        },
      });

      created += 1;
    }
  }

  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// ฟีดของลูกค้า
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationQuery {
  page: number;
  limit: number;
  unreadOnly: boolean;
  /** null = ทุกหมวด */
  group: NotificationGroup | null;
}

/**
 * การแจ้งเตือนของผู้ใช้คนหนึ่ง
 *
 * ⚠️ `userId` เป็นเงื่อนไขตายตัว — แถวประกาศของพนักงาน (`userId = null`) ไม่เข้าเงื่อนไขนี้
 *    จึงไม่มีทางหลุดมาที่ฟีดลูกค้า (มี test ยืนยัน)
 */
export async function listNotifications(
  userId: string,
  query: NotificationQuery,
): Promise<NotificationListDto> {
  const prisma = getPrisma();

  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.group !== null ? { type: { in: typesInGroup(query.group) } } : {}),
  };

  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where }),
    // นับที่ยังไม่อ่านจากทั้งฟีด ไม่ใช่แค่ผลที่กรองอยู่ — ตัวเลขบนกระดิ่งต้องตรงกันทุกหน้า
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    items: rows.map(toNotificationDto),
    unreadCount,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

/** จำนวนที่ยังไม่อ่าน — ใช้กับกระดิ่งบน navbar */
export function countUnreadNotifications(userId: string): Promise<number> {
  return getPrisma().notification.count({ where: { userId, readAt: null } });
}

/**
 * ทำเครื่องหมายว่าอ่านแล้ว
 *
 * กรอง `userId` เสมอ — ไม่ใช่ของเราคืน 404 ไม่ใช่ 403 (ไม่บอกใบ้ว่ามี id นั้นอยู่จริง)
 * กดซ้ำไม่ error เพราะผลลัพธ์ที่ผู้ใช้ต้องการเกิดขึ้นแล้ว
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<NotificationDto> {
  const prisma = getPrisma();

  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, readAt: true },
  });

  if (!existing) {
    throw ApiError.notFound('ไม่พบการแจ้งเตือนนี้');
  }

  const row = await prisma.notification.update({
    where: { id: notificationId },
    data: existing.readAt === null ? { readAt: new Date() } : {},
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      data: true,
      readAt: true,
      createdAt: true,
    },
  });

  return toNotificationDto(row);
}

/** อ่านทั้งหมด — คืนจำนวนที่เปลี่ยนสถานะจริง */
export async function markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
  const { count } = await getPrisma().notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: count };
}
