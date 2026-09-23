import { getPrisma, Prisma } from '@teenstyle/database';
import Stripe from 'stripe';

import { env } from '../config/env.ts';
import {
  isStripeConfigured,
  isStripeWebhookConfigured,
  paymentDeadline,
  paymentMethods,
  type PaymentMethodInfo,
  type PaymentProviderCode,
} from '../config/payment.ts';
import { toOrder, type OrderDto } from '../models/order.model.ts';
import { toNumber } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import { logger } from '../utils/logger.ts';

import { deductStockForOrder, releaseReservationForOrder } from './inventory.service.ts';
import {
  notifyCodConfirmed,
  notifyOrderCancelled,
  notifyPaymentFailed,
  notifyPaymentSuccess,
  notifySafely,
} from './notification.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';

/**
 * Payment service (STEP 11)
 *
 * กฎที่ห้ามละเมิด
 *   1. **ห้ามทำหน้าชำระเงินปลอม** — ช่องทางที่ยังตั้งค่าไม่ครบถูกปิดและบอกเหตุผลตรง ๆ
 *      ไม่มี endpoint ใดในไฟล์นี้ที่ทำให้ออเดอร์ "จ่ายแล้ว" ได้โดยไม่มีหลักฐานจาก provider
 *   2. **ห้ามเก็บ raw card data** — ผู้ใช้กรอกบัตรบนหน้าโฮสต์ของ Stripe
 *      เราเก็บเฉพาะ session/payment id + สถานะ (และตัด `rawPayload` เฉพาะฟิลด์ที่ปลอดภัย)
 *   3. **ยอดเงินอ่านจากออเดอร์ในฐานข้อมูลเท่านั้น** — client บอกได้แค่ว่าจะจ่ายวิธีไหน
 *   4. **Webhook ต้องตรวจลายเซ็นทุกครั้ง** และต้อง idempotent:
 *      - event id เดิม → ตรวจพบและไม่ทำอะไรซ้ำ
 *      - การเปลี่ยนสถานะออเดอร์ทำเฉพาะเมื่อสถานะปัจจุบันยังเป็น PENDING_PAYMENT
 *      - การตัดสต็อกกันซ้ำด้วย `InventoryMovement.idempotencyKey`
 *   5. **ตัดสต็อกจริงตอนนี้เท่านั้น** (จ่ายเงินสำเร็จ / ยืนยัน COD) — STEP 10 แค่จอง
 */

const ORDER_FOR_PAYMENT_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discountTotal: true,
  shippingFee: true,
  total: true,
  shippingMethod: true,
  addressSnapshot: true,
  customerNote: true,
  createdAt: true,
  paidAt: true,
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
} as const satisfies Prisma.OrderSelect;

type OrderForPayment = Prisma.OrderGetPayload<{ select: typeof ORDER_FOR_PAYMENT_SELECT }>;

let stripeClient: Stripe | null = null;

/** Stripe client แบบ lazy — ไม่สร้างถ้าไม่ได้ตั้งค่า */
function getStripe(): Stripe {
  if (env.STRIPE_SECRET_KEY === undefined) {
    throw ApiError.serviceUnavailable(
      'ยังไม่ได้ตั้งค่า Stripe (STRIPE_SECRET_KEY) — ดู docs/07-payment-setup.md',
    );
  }

  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY);

  return stripeClient;
}

/** variantId ของทุกรายการในออเดอร์ — ใช้ตรวจเตือนสต็อกหลังสต็อกขยับ (STEP 16) */
function variantIdsOf(order: { items: { variantId: string | null }[] }): string[] {
  return order.items.map((item) => item.variantId).filter((id): id is string => id !== null);
}

async function findOwnOrder(userId: string, orderNumber: string): Promise<OrderForPayment> {
  const order = await getPrisma().order.findFirst({
    where: { orderNumber, userId, deletedAt: null },
    select: ORDER_FOR_PAYMENT_SELECT,
  });

  if (!order) {
    throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');
  }

  return order;
}

export interface PaymentStateDto {
  order: OrderDto;
  methods: PaymentMethodInfo[];
  /** เวลาที่ต้องชำระเงินภายใน (ISO) */
  deadline: string;
  /** เลยกำหนดชำระแล้วไหม */
  expired: boolean;
  /** จ่ายเงินได้อยู่ไหม (ยังไม่จ่าย ยังไม่ยกเลิก ยังไม่เลยกำหนด) */
  payable: boolean;
  /** ประวัติการชำระเงินของออเดอร์นี้ */
  attempts: {
    provider: string;
    status: string;
    amount: number;
    createdAt: string;
    paidAt: string | null;
    failureReason: string | null;
  }[];
}

/** สถานะการชำระเงินของออเดอร์ + ช่องทางที่ใช้ได้จริง */
export async function getPaymentState(
  userId: string,
  orderNumber: string,
): Promise<PaymentStateDto> {
  const order = await findOwnOrder(userId, orderNumber);
  const payments = await getPrisma().payment.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: 'desc' },
    select: {
      provider: true,
      status: true,
      amount: true,
      createdAt: true,
      paidAt: true,
      failureReason: true,
    },
  });

  const deadline = paymentDeadline(order.createdAt);
  const expired = order.status === 'PENDING_PAYMENT' && deadline.getTime() < Date.now();

  return {
    order: toOrder(order),
    methods: paymentMethods(toNumber(order.total)),
    deadline: deadline.toISOString(),
    expired,
    payable: order.status === 'PENDING_PAYMENT' && order.paymentStatus === 'PENDING' && !expired,
    attempts: payments.map((payment) => ({
      provider: payment.provider,
      status: payment.status,
      amount: toNumber(payment.amount),
      createdAt: payment.createdAt.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      failureReason: payment.failureReason,
    })),
  };
}

function assertPayable(order: OrderForPayment): void {
  if (order.status === 'CANCELLED') {
    throw ApiError.conflict('คำสั่งซื้อนี้ถูกยกเลิกแล้ว');
  }

  if (order.paymentStatus === 'PAID' || order.status !== 'PENDING_PAYMENT') {
    throw ApiError.conflict('คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงิน');
  }

  if (paymentDeadline(order.createdAt).getTime() < Date.now()) {
    throw ApiError.conflict('เลยกำหนดชำระเงินแล้ว — กรุณาสั่งซื้อใหม่');
  }
}

export type StartPaymentResult =
  | { kind: 'confirmed'; provider: PaymentProviderCode; order: OrderDto }
  | { kind: 'redirect'; provider: PaymentProviderCode; url: string };

/**
 * เริ่มขั้นตอนชำระเงิน
 *
 * COD    → ยืนยันออเดอร์ทันที (เก็บเงินตอนส่ง) + **ตัดสต็อกจริง**
 * STRIPE → สร้าง Checkout Session แล้วให้ผู้ใช้ไปกรอกบัตรบนหน้าของ Stripe
 *          สถานะจะเปลี่ยนเป็นจ่ายแล้วได้ **เฉพาะเมื่อ webhook ที่ลายเซ็นถูกต้องเข้ามา**
 */
export async function startPayment(
  userId: string,
  orderNumber: string,
  provider: PaymentProviderCode,
  origin: string,
): Promise<StartPaymentResult> {
  const order = await findOwnOrder(userId, orderNumber);
  assertPayable(order);

  const method = paymentMethods(toNumber(order.total)).find((item) => item.code === provider);

  if (!method || !method.available) {
    throw ApiError.badRequest(method?.unavailableReason ?? 'ช่องทางชำระเงินนี้ยังใช้งานไม่ได้');
  }

  if (provider === 'COD') {
    return { kind: 'confirmed', provider, order: await confirmCashOnDelivery(order, userId) };
  }

  return { kind: 'redirect', provider, url: await createStripeCheckout(order, origin) };
}

/**
 * COD — ยืนยันคำสั่งซื้อและตัดสต็อกทันที (ของออกจากคลังไปกับพนักงานส่ง)
 * `paymentStatus` ยังเป็น PENDING ตามจริง เพราะเงินจะได้รับตอนส่งถึง
 */
async function confirmCashOnDelivery(
  order: OrderForPayment,
  actorUserId: string,
): Promise<OrderDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    // ตรวจสถานะอีกครั้งในทรานแซกชัน (กันกดสองครั้งพร้อมกัน)
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paymentStatus: true },
    });

    if (fresh.status !== 'PENDING_PAYMENT') {
      throw ApiError.conflict('คำสั่งซื้อนี้ถูกยืนยันไปแล้ว');
    }

    await deductStockForOrder(
      tx,
      order,
      actorUserId,
      `ตัดสต็อกจากคำสั่งซื้อ ${order.orderNumber} (เก็บเงินปลายทาง)`,
    );

    await tx.payment.upsert({
      where: { idempotencyKey: `order:${order.id}:cod` },
      create: {
        orderId: order.id,
        provider: 'COD',
        status: 'PENDING',
        amount: order.total,
        idempotencyKey: `order:${order.id}:cod`,
      },
      update: {},
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PROCESSING',
        // ยังไม่ได้รับเงิน — ห้ามตั้งเป็น PAID
        paymentStatus: 'PENDING',
        processedAt: new Date(),
      },
    });
  });

  // ตัดสต็อกจริงแล้ว → ตรวจเตือนหลัง commit (STEP 16)
  await scanAlertsAfterStockChange(variantIdsOf(order));

  /**
   * ⚠️ COD ยังไม่ได้รับเงินตอนนี้ (กฎ STEP 11 ข้อ 2) จึงแจ้งว่า "ยืนยันคำสั่งซื้อแล้ว"
   *    ไม่ใช่ "ชำระเงินสำเร็จ" — เงินเข้าตอนกด DELIVERED ที่หลังบ้าน (STEP 24)
   */
  await notifySafely(
    () =>
      notifyCodConfirmed(
        { userId: order.userId, orderId: order.id, orderNumber: order.orderNumber },
        toNumber(order.total),
      ),
    `order:${order.id}:cod-confirmed`,
  );

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: ORDER_FOR_PAYMENT_SELECT,
  });

  return toOrder(updated);
}

/** สร้าง Stripe Checkout Session จากยอดจริงในออเดอร์ */
async function createStripeCheckout(order: OrderForPayment, origin: string): Promise<string> {
  const stripe = getStripe();
  const prisma = getPrisma();

  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: `order:${order.id}:stripe` },
    select: { id: true, providerPaymentId: true, status: true },
  });

  // ถ้ามี session ที่ยังเปิดอยู่ ให้กลับไปที่เดิม ไม่สร้างใหม่ซ้ำ ๆ
  if (existing?.providerPaymentId) {
    const previous = await stripe.checkout.sessions.retrieve(existing.providerPaymentId);

    if (previous.status === 'open' && previous.url) {
      return previous.url;
    }
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => ({
    quantity: item.quantity,
    price_data: {
      currency: 'thb',
      // Stripe คิดเป็นหน่วยย่อย (สตางค์)
      unit_amount: Math.round(toNumber(item.unitPrice) * 100),
      product_data: {
        name: item.productName,
        description: [item.colorName, item.sizeName].filter(Boolean).join(' · ') || undefined,
      },
    },
  }));

  const shippingFee = toNumber(order.shippingFee);
  if (shippingFee > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'thb',
        unit_amount: Math.round(shippingFee * 100),
        product_data: { name: 'ค่าจัดส่ง' },
      },
    });
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: lineItems,
      client_reference_id: order.orderNumber,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      payment_intent_data: {
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      },
      success_url: `${origin}/checkout/success?order=${order.orderNumber}`,
      cancel_url: `${origin}/checkout/success?order=${order.orderNumber}&canceled=1`,
      expires_at: Math.floor(paymentDeadline(order.createdAt).getTime() / 1000),
    },
    // กัน session ซ้ำถ้า request เดิมถูกยิงใหม่ (retry ระดับ HTTP)
    { idempotencyKey: `order:${order.id}:stripe:session` },
  );

  if (!session.url) {
    throw ApiError.serviceUnavailable('Stripe ไม่ส่งลิงก์ชำระเงินกลับมา');
  }

  await prisma.payment.upsert({
    where: { idempotencyKey: `order:${order.id}:stripe` },
    create: {
      orderId: order.id,
      provider: 'STRIPE',
      status: 'PROCESSING',
      amount: order.total,
      providerPaymentId: session.id,
      idempotencyKey: `order:${order.id}:stripe`,
    },
    update: { providerPaymentId: session.id, status: 'PROCESSING' },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { paymentStatus: 'PROCESSING' },
  });

  return session.url;
}

export interface WebhookResult {
  eventId: string;
  eventType: string;
  /** true = event นี้ถูกประมวลผลไปแล้ว จึงไม่ทำอะไรซ้ำ */
  duplicate: boolean;
  /** สิ่งที่เกิดขึ้นจริงกับออเดอร์ */
  action: 'paid' | 'cancelled' | 'failed' | 'ignored';
}

/**
 * รับ webhook จาก Stripe
 *
 * ⚠️ ต้องส่ง **raw body** มาที่นี่ (ไม่ใช่ object ที่ parse แล้ว) เพราะลายเซ็นคิดจากไบต์ดิบ
 *    app.ts จึง mount `express.raw()` ให้เฉพาะเส้นทางนี้
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<WebhookResult> {
  if (!isStripeWebhookConfigured || env.STRIPE_WEBHOOK_SECRET === undefined) {
    throw ApiError.serviceUnavailable('ยังไม่ได้ตั้งค่า STRIPE_WEBHOOK_SECRET');
  }

  if (signature === undefined || signature === '') {
    throw ApiError.badRequest('ไม่มีลายเซ็น Stripe ในคำขอ');
  }

  let event: Stripe.Event;

  try {
    // ใช้ตัวตรวจลายเซ็นของ Stripe เอง (HMAC + กัน replay ด้วย timestamp)
    event = Stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      'stripe webhook: ลายเซ็นไม่ถูกต้อง',
    );
    throw ApiError.badRequest('ลายเซ็น Stripe ไม่ถูกต้อง');
  }

  const prisma = getPrisma();

  // idempotency ชั้นแรก: event id เดิมที่เคยประมวลผลแล้ว
  const seen = await prisma.payment.findFirst({
    where: { webhookEventId: event.id },
    select: { id: true },
  });

  if (seen) {
    return { eventId: event.id, eventType: event.type, duplicate: true, action: 'ignored' };
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      const action = await markOrderPaid(event.id, session);
      return { eventId: event.id, eventType: event.type, duplicate: false, action };
    }

    case 'checkout.session.expired': {
      const action = await releaseOrderFromSession(event.id, event.data.object, 'expired');
      return { eventId: event.id, eventType: event.type, duplicate: false, action };
    }

    case 'checkout.session.async_payment_failed': {
      const action = await releaseOrderFromSession(event.id, event.data.object, 'failed');
      return { eventId: event.id, eventType: event.type, duplicate: false, action };
    }

    default:
      // event อื่นไม่กระทบสถานะออเดอร์ — บันทึก log แล้วตอบ 200 เพื่อไม่ให้ Stripe ยิงซ้ำ
      logger.info({ eventType: event.type }, 'stripe webhook: ข้าม event ที่ไม่เกี่ยวข้อง');
      return { eventId: event.id, eventType: event.type, duplicate: false, action: 'ignored' };
  }
}

/** ตัวระบุออเดอร์จาก session ของ Stripe (metadata เป็นหลัก) */
function orderIdFromSession(session: Stripe.Checkout.Session): string | null {
  const fromMetadata = session.metadata?.['orderId'];

  return typeof fromMetadata === 'string' && fromMetadata.length > 0 ? fromMetadata : null;
}

/**
 * ทำให้ออเดอร์เป็น "จ่ายแล้ว" + ตัดสต็อกจริง — ทั้งหมดในทรานแซกชันเดียว
 *
 * เรียกซ้ำได้ปลอดภัย: เปลี่ยนสถานะเฉพาะเมื่อยังเป็น PENDING_PAYMENT
 * และการตัดสต็อกกันซ้ำด้วย idempotencyKey ของ InventoryMovement
 */
async function markOrderPaid(
  eventId: string,
  session: Stripe.Checkout.Session,
): Promise<WebhookResult['action']> {
  const orderId = orderIdFromSession(session);

  if (orderId === null) {
    logger.warn({ sessionId: session.id }, 'stripe webhook: session ไม่มี orderId ใน metadata');
    return 'ignored';
  }

  const prisma = getPrisma();

  // เก็บไว้ตรวจเตือนสต็อกหลังทรานแซกชัน commit — ตั้งค่าเฉพาะเส้นทางที่ตัดสต็อกจริง
  let deductedVariantIds: string[] = [];

  const action = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: ORDER_FOR_PAYMENT_SELECT,
    });

    if (!order) {
      logger.warn({ orderId }, 'stripe webhook: ไม่พบออเดอร์ที่อ้างถึง');
      return 'ignored';
    }

    // จ่ายแล้วหรือถูกยกเลิกไปแล้ว → ไม่ทำอะไรซ้ำ
    if (order.paymentStatus === 'PAID' || order.status !== 'PENDING_PAYMENT') {
      await tx.payment.updateMany({
        where: { orderId, webhookEventId: null },
        data: { webhookEventId: eventId },
      });
      return 'ignored';
    }

    deductedVariantIds = variantIdsOf(order);

    await deductStockForOrder(
      tx,
      order,
      null,
      `ตัดสต็อกจากคำสั่งซื้อ ${order.orderNumber} (ชำระเงินผ่าน Stripe)`,
    );

    const paidAt = new Date();

    await tx.payment.upsert({
      where: { idempotencyKey: `order:${orderId}:stripe` },
      create: {
        orderId,
        provider: 'STRIPE',
        status: 'PAID',
        amount: order.total,
        providerPaymentId: session.id,
        providerRef: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        idempotencyKey: `order:${orderId}:stripe`,
        webhookEventId: eventId,
        paidAt,
        // เก็บเฉพาะข้อมูลสรุปที่ปลอดภัย — ห้ามเก็บข้อมูลบัตร
        rawPayload: {
          sessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
          paymentStatus: session.payment_status,
        },
      },
      update: {
        status: 'PAID',
        webhookEventId: eventId,
        paidAt,
        providerRef: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: 'PAID', paymentStatus: 'PAID', paidAt },
    });

    return 'paid';
  });

  await scanAlertsAfterStockChange(deductedVariantIds);

  /**
   * แจ้งเตือนเฉพาะเมื่อคำขอนี้เป็นตัวที่เปลี่ยนสถานะจริง (STEP 24)
   *
   * event เดิมที่ Stripe ยิงซ้ำจะคืน `ignored` จึงไม่มาถึงตรงนี้
   * และ `notifyOnce` ยังกันซ้ำอีกชั้นอยู่ดี
   */
  if (action === 'paid') {
    const paid = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, orderNumber: true, total: true },
    });

    if (paid !== null) {
      await notifySafely(
        () =>
          notifyPaymentSuccess(
            { userId: paid.userId, orderId, orderNumber: paid.orderNumber },
            toNumber(paid.total),
          ),
        `order:${orderId}:paid`,
      );
    }
  }

  return action;
}

/** session หมดอายุ/จ่ายไม่สำเร็จ → คืนของที่จองไว้ และยกเลิกออเดอร์ */
async function releaseOrderFromSession(
  eventId: string,
  session: Stripe.Checkout.Session,
  kind: 'expired' | 'failed',
): Promise<WebhookResult['action']> {
  const orderId = orderIdFromSession(session);

  if (orderId === null) return 'ignored';

  const prisma = getPrisma();
  let releasedVariantIds: string[] = [];

  const action = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: ORDER_FOR_PAYMENT_SELECT,
    });

    if (!order) return 'ignored';

    // จ่ายเงินสำเร็จไปแล้ว หรือถูกจัดการไปแล้ว → ห้ามคืนของ (ของถูกตัดออกไปแล้ว)
    if (order.status !== 'PENDING_PAYMENT' || order.paymentStatus === 'PAID') {
      return 'ignored';
    }

    releasedVariantIds = variantIdsOf(order);

    await releaseReservationForOrder(tx, order);

    await tx.payment.updateMany({
      where: { orderId },
      data: {
        status: kind === 'failed' ? 'FAILED' : 'CANCELLED',
        webhookEventId: eventId,
        failedAt: new Date(),
        failureReason: kind === 'failed' ? 'ชำระเงินไม่สำเร็จ' : 'หมดเวลาชำระเงิน',
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        paymentStatus: kind === 'failed' ? 'FAILED' : 'CANCELLED',
        cancelledAt: new Date(),
        adminNote: kind === 'failed' ? 'Stripe: ชำระเงินไม่สำเร็จ' : 'Stripe: หมดเวลาชำระเงิน',
      },
    });

    return kind === 'failed' ? 'failed' : 'cancelled';
  });

  await scanAlertsAfterStockChange(releasedVariantIds);

  // แจ้งเฉพาะเมื่อคำขอนี้เป็นตัวที่ยกเลิกออเดอร์จริง — event ซ้ำคืน `ignored` จึงไม่มาถึงตรงนี้
  if (action === 'failed' || action === 'cancelled') {
    const released = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, orderNumber: true },
    });

    if (released !== null) {
      await notifySafely(
        () =>
          notifyPaymentFailed(
            { userId: released.userId, orderId, orderNumber: released.orderNumber },
            kind === 'failed' ? 'ธนาคารปฏิเสธการชำระเงิน' : 'เลยกำหนดเวลาชำระเงินแล้ว',
          ),
        `order:${orderId}:payment-failed`,
      );
    }
  }

  return action;
}

/**
 * ลูกค้ายกเลิกคำสั่งซื้อที่ยังไม่ได้ชำระเงิน → คืนของที่จองไว้เข้าคลัง
 * (ปิดช่องว่างของ STEP 10 ที่ของค้างจองไว้เรื่อย ๆ)
 */
export async function cancelUnpaidOrder(userId: string, orderNumber: string): Promise<OrderDto> {
  const order = await findOwnOrder(userId, orderNumber);

  if (order.paymentStatus === 'PAID' || order.status !== 'PENDING_PAYMENT') {
    throw ApiError.conflict('ยกเลิกได้เฉพาะคำสั่งซื้อที่ยังไม่ได้ชำระเงินและยังไม่ถูกจัดส่ง');
  }

  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, paymentStatus: true },
    });

    if (fresh.status !== 'PENDING_PAYMENT' || fresh.paymentStatus === 'PAID') {
      throw ApiError.conflict('คำสั่งซื้อนี้ถูกจัดการไปแล้ว');
    }

    await releaseReservationForOrder(tx, order);

    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'CANCELLED', failureReason: 'ลูกค้ายกเลิกคำสั่งซื้อ', failedAt: new Date() },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', paymentStatus: 'CANCELLED', cancelledAt: new Date() },
    });
  });

  // ของที่จองไว้กลับมาขายได้ → การเตือนที่ค้างอยู่ต้องถูกปิดเอง (STEP 16)
  await scanAlertsAfterStockChange(variantIdsOf(order));

  await notifySafely(
    () =>
      notifyOrderCancelled(
        { userId: order.userId, orderId: order.id, orderNumber: order.orderNumber },
        'customer',
      ),
    `order:${order.id}:cancelled-by-customer`,
  );

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: ORDER_FOR_PAYMENT_SELECT,
  });

  return toOrder(updated);
}

/**
 * ยกเลิกคำสั่งซื้อที่เลยกำหนดชำระเงิน แล้วคืนของเข้าคลัง
 *
 * ตอนนี้เรียกได้จาก admin (STEP 13) — STEP 52 จะให้ job รันอัตโนมัติทุก ๆ ช่วงเวลา
 * คืนจำนวนออเดอร์ที่ถูกยกเลิกในรอบนี้
 */
export async function expireOverdueOrders(now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - env.PAYMENT_WINDOW_MINUTES * 60 * 1000);

  const overdue = await prisma.order.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      paymentStatus: { in: ['PENDING', 'PROCESSING'] },
      createdAt: { lt: cutoff },
      deletedAt: null,
    },
    select: ORDER_FOR_PAYMENT_SELECT,
  });

  let cancelled = 0;
  const releasedVariantIds: string[] = [];
  /** ออเดอร์ที่ถูกยกเลิกจริงในรอบนี้ — แจ้งเตือนหลังทรานแซกชันของแต่ละใบ commit แล้ว */
  const expiredTargets: { userId: string; orderId: string; orderNumber: string }[] = [];

  for (const order of overdue) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true, paymentStatus: true },
      });

      if (fresh.status !== 'PENDING_PAYMENT' || fresh.paymentStatus === 'PAID') return;

      await releaseReservationForOrder(tx, order);

      await tx.payment.updateMany({
        where: { orderId: order.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'CANCELLED', failureReason: 'หมดเวลาชำระเงิน', failedAt: new Date() },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED',
          cancelledAt: new Date(),
          adminNote: 'ยกเลิกอัตโนมัติ: เลยกำหนดชำระเงิน',
        },
      });

      releasedVariantIds.push(...variantIdsOf(order));
      expiredTargets.push({
        userId: order.userId,
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
      cancelled += 1;
    });
  }

  // ของที่จองไว้กลับมาขายได้ทั้งหมด → ตรวจปิดการเตือนที่ค้างในรอบเดียว
  await scanAlertsAfterStockChange(releasedVariantIds);

  for (const target of expiredTargets) {
    await notifySafely(
      () => notifyPaymentFailed(target, 'เลยกำหนดเวลาชำระเงินแล้ว'),
      `order:${target.orderId}:expired`,
    );
  }

  return cancelled;
}

export { isStripeConfigured };
