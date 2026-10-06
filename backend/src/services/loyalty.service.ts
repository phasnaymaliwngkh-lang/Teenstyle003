import { getPrisma, type Prisma } from '@teenstyle/database';

import type { LoyaltyTierCode } from '../config/loyalty.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';
import {
  evaluateRedemption,
  isHigherTier,
  loyaltyRules,
  pointsEarnedFor,
  tierForSpend,
  toPointTransactionDto,
  toStanding,
  type LoyaltyRulesDto,
  type LoyaltyStandingDto,
  type PointTransactionDto,
  type PointTransactionTypeCode,
  type RedemptionEvaluation,
} from '../models/loyalty.model.ts';
import { PAID_ORDER_WHERE } from '../models/order.model.ts';
import { computePointsShare } from '../models/return.model.ts';
import { toNumber } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import type { AdjustPointsInput } from '../validators/loyalty.validator.ts';

import { assertCanManage, type CustomerActor } from './admin-customer.service.ts';
import { notifyPointsAdjusted, notifySafely, notifyTierUpgraded } from './notification.service.ts';

/**
 * แต้มสะสมและระดับสมาชิก (STEP 42)
 *
 * ⚠️ กฎการคิดอยู่ที่ [models/loyalty.model.ts](../models/loyalty.model.ts) ที่เดียว
 *    ไฟล์นี้มีหน้าที่หาข้อมูลจริงมาป้อนให้มันคิด แล้วบันทึกผลลงสมุดแต้ม
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **`User.points` เปลี่ยนได้ทางเดียวคือ `postPointTransaction()`** ซึ่งเขียนแถวในสมุดแต้ม
 *    คู่กันในทรานแซกชันเดียว — ยอดคงเหลือจึงอธิบายได้ด้วยประวัติเสมอ
 *    (แพตเทิร์นเดียวกับ `Inventory.quantity` ↔ `InventoryMovement` ของ STEP 15)
 * 2. **หักแต้มด้วย SQL เดียวแบบมีเงื่อนไข** (`points + delta >= 0` อยู่ใน WHERE)
 *    สองคำสั่งซื้อแย่งใช้แต้มก้อนเดียวกันพร้อมกัน → สำเร็จรายเดียว
 *    และมี CHECK `User_points_non_negative` เป็นด่านสุดท้าย
 * 3. **ได้แต้มเมื่อร้านได้รับเงินจริงเท่านั้น** — Stripe: ตอน webhook ยืนยัน ·
 *    COD: ตอนกดส่งถึง (จุดที่ตั้ง PAID ตามกฎ STEP 13 ข้อ 4) · ไม่ใช่ตอนกดสั่งซื้อ
 * 4. **ยกเลิกคำสั่งซื้อต้องคืนแต้มที่ใช้ และหักแต้มที่ได้** ทุกเส้นทางที่ยกเลิก
 *    (เรียก `releasePointsForCancelledOrder()` คู่กับการคืนโควตาคูปองของ STEP 41)
 * 5. **ทุกรายการกันซ้ำด้วย `idempotencyKey`** — webhook ยิงซ้ำ · แอดมินกดปุ่มซ้ำ
 *    ต้องไม่ได้แต้มสองเท่า
 */

type DbClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

/* ═══════════════════════ ตัวเขียนสมุดแต้ม (ตัวเดียว) ═══════════════════════ */

interface PostPointInput {
  userId: string;
  type: PointTransactionTypeCode;
  delta: number;
  description: string;
  idempotencyKey: string;
  orderId?: string | null;
  createdById?: string | null;
  /** ข้อความเมื่อแต้มไม่พอ — แต่ละเส้นทางต้องบอกผู้ใช้คนละแบบ */
  insufficientMessage?: string;
}

export interface PostPointResult {
  /** false = เคยบันทึกด้วยคีย์นี้แล้ว (คำขอซ้ำ) จึงไม่ได้เขียนอะไรเพิ่ม */
  posted: boolean;
  transactionId: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * บันทึกรายการแต้มหนึ่งแถว + อัปเดตยอดคงเหลือ — **ต้องเรียกในทรานแซกชันเท่านั้น**
 *
 * ⚠️ `updatedAt` ต้องเซ็ตเอง เพราะ `@updatedAt` ของ Prisma ไม่ทำงานกับ raw SQL (กฎ STEP 15 ข้อ 3)
 */
export async function postPointTransaction(
  tx: Prisma.TransactionClient,
  input: PostPointInput,
): Promise<PostPointResult> {
  const existing = await tx.pointTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, delta: true, balanceBefore: true, balanceAfter: true },
  });

  if (existing) {
    return {
      posted: false,
      transactionId: existing.id,
      delta: existing.delta,
      balanceBefore: existing.balanceBefore,
      balanceAfter: existing.balanceAfter,
    };
  }

  const rows = await tx.$queryRaw<{ after: number }[]>`
    UPDATE "User"
       SET "points" = "points" + ${input.delta}, "updatedAt" = now()
     WHERE "id" = ${input.userId}::uuid
       AND "points" + ${input.delta} >= 0
    RETURNING "points" AS "after"`;

  if (rows.length === 0) {
    throw ApiError.conflict(input.insufficientMessage ?? 'แต้มคงเหลือไม่พอสำหรับรายการนี้');
  }

  const balanceAfter = Number(rows[0]!.after);
  const balanceBefore = balanceAfter - input.delta;

  const created = await tx.pointTransaction.create({
    data: {
      userId: input.userId,
      type: input.type,
      delta: input.delta,
      balanceBefore,
      balanceAfter,
      description: input.description,
      orderId: input.orderId ?? null,
      createdById: input.createdById ?? null,
      idempotencyKey: input.idempotencyKey,
    },
    select: { id: true },
  });

  return {
    posted: true,
    transactionId: created.id,
    delta: input.delta,
    balanceBefore,
    balanceAfter,
  };
}

/* ═══════════════════════ ยอดสะสม · ระดับสมาชิก ═══════════════════════ */

/**
 * ยอดที่จ่ายจริงสะสมของผู้ใช้ — นับจากตาราง Order ด้วยเกณฑ์ `PAID_ORDER_WHERE`
 * (เกณฑ์เดียวกับ "ยอดที่ได้รับ" ที่หลังบ้านโชว์) **ไม่มีคอลัมน์ cache ให้ค้างค่าเก่า**
 */
export async function lifetimeSpendOf(
  client: DbClient,
  userId: string,
  options: { excludeOrderId?: string } = {},
): Promise<number> {
  const result = await client.order.aggregate({
    where: {
      ...PAID_ORDER_WHERE,
      userId,
      ...(options.excludeOrderId !== undefined ? { id: { not: options.excludeOrderId } } : {}),
    },
    _sum: { total: true, refundedTotal: true },
  });

  // เงินที่คืนลูกค้าไปแล้วไม่ใช่ "ยอดที่จ่ายจริง" (STEP 43) — ใบที่คืนครบหลุดจาก PAID_ORDER_WHERE เอง
  return toNumber(result._sum.total) - toNumber(result._sum.refundedTotal);
}

export async function standingOf(client: DbClient, userId: string): Promise<LoyaltyStandingDto> {
  const [user, spend] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { points: true } }),
    lifetimeSpendOf(client, userId),
  ]);

  return toStanding(user?.points ?? 0, spend);
}

/* ═══════════════════════ ใช้แต้มตอนสั่งซื้อ ═══════════════════════ */

/** แต้มคงเหลือ — อ่านจากฐานข้อมูลเสมอ ไม่ใช่จากค่าที่หน้าเว็บส่งมา */
async function balanceOf(client: DbClient, userId: string): Promise<number> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { points: true } });

  return user?.points ?? 0;
}

/** ตรวจการใช้แต้มกับบิล (ใช้ทั้งหน้าสรุปยอดและตอนสร้างคำสั่งซื้อจริง) */
export async function evaluateRedemptionFor(
  client: DbClient,
  params: { userId: string; requested: number; subtotal: number; otherDiscount: number },
): Promise<RedemptionEvaluation & { balance: number }> {
  const balance = await balanceOf(client, params.userId);

  return {
    ...evaluateRedemption({
      requested: params.requested,
      balance,
      subtotal: params.subtotal,
      otherDiscount: params.otherDiscount,
    }),
    balance,
  };
}

/**
 * หักแต้มที่ใช้เป็นส่วนลด — เรียก **ในทรานแซกชันเดียวกับการสร้างคำสั่งซื้อ** หลังสร้างแถวแล้ว
 *
 * ถ้าแต้มถูกใช้ไปในอีกคำสั่งซื้อระหว่างนั้น SQL แบบมีเงื่อนไขจะไม่อัปเดตแถว → 409
 * → ทรานแซกชัน rollback ทั้งก้อน (ไม่มีคำสั่งซื้อที่ได้ส่วนลดจากแต้มที่ไม่มีอยู่จริง)
 */
export async function redeemPointsForOrder(
  tx: Prisma.TransactionClient,
  params: { userId: string; orderId: string; orderNumber: string; points: number },
): Promise<void> {
  if (params.points <= 0) return;

  await postPointTransaction(tx, {
    userId: params.userId,
    type: 'REDEEM',
    delta: -params.points,
    description: `ใช้เป็นส่วนลดในคำสั่งซื้อ ${params.orderNumber}`,
    orderId: params.orderId,
    idempotencyKey: `order:${params.orderId}:redeem`,
    insufficientMessage: 'แต้มไม่พอแล้ว — อาจถูกใช้ในคำสั่งซื้ออื่นไปพร้อมกัน กรุณาลองใหม่',
  });
}

/* ═══════════════════════ ได้แต้มเมื่อร้านได้รับเงิน ═══════════════════════ */

export interface PointsAward {
  userId: string;
  orderId: string;
  orderNumber: string;
  points: number;
  tierBefore: LoyaltyTierCode;
  tierAfter: LoyaltyTierCode;
}

/**
 * ให้แต้มจากคำสั่งซื้อที่ร้านได้รับเงินแล้ว — เรียก **หลังอัปเดตออเดอร์เป็น PAID**
 * ในทรานแซกชันเดียวกัน (Stripe webhook · COD ตอนกดส่งถึง)
 *
 * เรียกซ้ำได้ปลอดภัย: กันซ้ำด้วยคีย์ `order:<id>:earn`
 * ออเดอร์ที่ยังไม่ได้เงิน/ถูกยกเลิก → ไม่ให้แต้ม (คืน null)
 *
 * @returns ผลการให้แต้ม เพื่อให้ผู้เรียกแจ้งเตือนลูกค้า **หลัง commit** · null = ไม่มีอะไรเกิดขึ้น
 */
export async function awardPointsForPaidOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PointsAward | null> {
  const order = await tx.order.findFirst({
    where: { id: orderId, ...PAID_ORDER_WHERE },
    select: { id: true, userId: true, orderNumber: true, total: true },
  });

  if (order === null) return null;

  const key = `order:${order.id}:earn`;
  const already = await tx.pointTransaction.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });

  if (already) return null;

  /**
   * ตัวคูณใช้ระดับ **ก่อน** นับใบนี้ — ใบที่ทำให้ขึ้นระดับยังได้แต้มตามระดับเดิม
   * (ถ้าใช้ระดับหลัง ลูกค้าจะได้โบนัสย้อนหลังจากเงินก้อนที่ยังไม่ได้อยู่ระดับนั้นจริง)
   */
  const total = toNumber(order.total);
  const spendBefore = await lifetimeSpendOf(tx, order.userId, { excludeOrderId: order.id });
  const tierBefore = tierForSpend(spendBefore);
  const tierAfter = tierForSpend(spendBefore + total);
  const points = pointsEarnedFor(total, tierBefore);

  if (points > 0) {
    const bonus =
      tierBefore.earnMultiplierPercent === 100
        ? ''
        : ` (ระดับ ${tierBefore.name} ×${tierBefore.earnMultiplierPercent / 100})`;

    await postPointTransaction(tx, {
      userId: order.userId,
      type: 'EARN',
      delta: points,
      description: `ได้รับจากคำสั่งซื้อ ${order.orderNumber}${bonus}`,
      orderId: order.id,
      idempotencyKey: key,
    });
  }

  return {
    userId: order.userId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    points,
    tierBefore: tierBefore.code,
    tierAfter: tierAfter.code,
  };
}

/**
 * แจ้งลูกค้าเมื่อขึ้นระดับ — เรียก **หลัง commit** เท่านั้น (กฎ STEP 24 ข้อ 4)
 * แต้มที่ได้ถูกแจ้งรวมไปกับ "ชำระเงินสำเร็จ" อยู่แล้ว จึงไม่แจ้งแยกอีกรายการ (กัน noise)
 */
export async function notifyAfterAward(award: PointsAward | null): Promise<void> {
  if (award === null || !isHigherTier(award.tierAfter, award.tierBefore)) return;

  await notifySafely(
    () => notifyTierUpgraded(award.userId, award.tierAfter, award.orderNumber),
    `loyalty:${award.userId}:tier:${award.tierAfter}`,
  );
}

/* ═══════════════════════ ยกเลิกคำสั่งซื้อ ═══════════════════════ */

export interface PointsRelease {
  /** แต้มที่ใช้ไปแล้วได้คืน */
  refunded: number;
  /** แต้มที่เคยได้แล้วถูกหักคืน */
  reversed: number;
}

/**
 * คืนแต้มที่ใช้ + หักแต้มที่ได้ ของคำสั่งซื้อที่ถูกยกเลิก — เรียกคู่กับการคืนสต็อก **ทุกที่**
 *
 * ⚠️ แต้มที่ได้อาจถูกใช้ไปแล้ว (ได้จากใบ A แล้วเอาไปลดใบ B ก่อนใบ A ถูกยกเลิก)
 *    → หักได้ไม่เกินยอดคงเหลือ แล้ว **บันทึกตรง ๆ ว่าหักไม่ครบเท่าไร** ไม่ใช่ทำให้การยกเลิกล้ม
 *    (ร้านต้องยกเลิกคำสั่งซื้อได้เสมอ · ยอดติดลบไม่ได้ตาม CHECK ของฐานข้อมูล)
 *
 * คืนก่อนหัก: ถ้าใบเดียวกันทั้งใช้และได้แต้ม แต้มที่คืนมาจะช่วยให้หักได้ครบ
 */
export async function releasePointsForCancelledOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<PointsRelease> {
  return movePointsBack(tx, {
    orderId,
    keyPrefix: `order:${orderId}`,
    // ยกเลิก = ทั้งบิลไม่เกิดขึ้น → คืน/หักส่วนที่ "ยังเหลือ" ทั้งหมด
    give: (redeemed, alreadyRefunded) => redeemed - alreadyRefunded,
    take: (earned, alreadyReversed) => earned - alreadyReversed,
    describeGive: (orderNumber) => `คืนแต้มที่ใช้ เพราะคำสั่งซื้อ ${orderNumber} ถูกยกเลิก`,
    describeTake: (orderNumber) => `หักแต้มที่ได้จากคำสั่งซื้อ ${orderNumber} เพราะถูกยกเลิก`,
  });
}

/**
 * แต้มของคำขอคืนสินค้าที่คืนเงินแล้ว (STEP 43) — **ตามสัดส่วนเดียวกับเงิน**
 *
 * คืนบางชิ้น → คืนแต้มที่ใช้ / หักแต้มที่ได้ ตามสัดส่วน "มูลค่าชิ้นที่คืน ÷ ยอดสินค้า"
 * คืนครบทุกชิ้นแล้ว → ส่วนที่ยังเหลือทั้งหมด (สูตรอยู่ที่ `computePointsShare` ใน return.model.ts)
 * เรียก **ในทรานแซกชันเดียวกับการบันทึกการคืนเงิน**
 */
export async function settlePointsForReturn(
  tx: Prisma.TransactionClient,
  params: {
    orderId: string;
    returnRequestId: string;
    returnNumber: string;
    goods: number;
    subtotal: number;
    final: boolean;
  },
): Promise<PointsRelease> {
  const share = (total: number, alreadyMoved: number) =>
    computePointsShare({
      totalPoints: total,
      alreadyMoved,
      goods: params.goods,
      subtotal: params.subtotal,
      final: params.final,
    });

  return movePointsBack(tx, {
    orderId: params.orderId,
    keyPrefix: `return:${params.returnRequestId}`,
    give: share,
    take: share,
    describeGive: () => `คืนแต้มที่ใช้ตามสัดส่วนของสินค้าที่คืน (${params.returnNumber})`,
    describeTake: () => `หักแต้มที่ได้ตามสัดส่วนของสินค้าที่คืน (${params.returnNumber})`,
  });
}

/**
 * ตัวกลางของการคืนแต้มที่ใช้ + หักแต้มที่ได้ของคำสั่งซื้อหนึ่งใบ
 *
 * อ่านยอดจากสมุดแต้มของใบนั้นทุกครั้ง (ใช้ไปเท่าไร · คืนไปแล้วเท่าไร · ได้เท่าไร · หักไปแล้วเท่าไร)
 * แล้วให้ผู้เรียกตัดสินว่าครั้งนี้ควรคืน/หักเท่าไร — ยกเลิกทั้งใบกับคืนบางชิ้นจึงใช้ตัวเดียวกัน
 * และไม่มีทางคืนเกินที่ใช้ไป หรือหักเกินที่ได้ไป แม้จะเกิดทั้งสองเส้นทางกับใบเดียวกัน
 *
 * ⚠️ แต้มที่ได้อาจถูกใช้ไปแล้ว → หักได้ไม่เกินยอดคงเหลือ แล้ว **บันทึกตรง ๆ ว่าขาดเท่าไร**
 *    ไม่ทำให้การยกเลิก/การคืนเงินล้ม (ยอดติดลบไม่ได้ตาม CHECK ของฐานข้อมูล)
 * ⚠️ คืนก่อนหัก — ใบเดียวกันที่ทั้งใช้และได้แต้ม แต้มที่คืนมาช่วยให้หักได้ครบ
 */
async function movePointsBack(
  tx: Prisma.TransactionClient,
  params: {
    orderId: string;
    keyPrefix: string;
    give: (redeemed: number, alreadyRefunded: number) => number;
    take: (earned: number, alreadyReversed: number) => number;
    describeGive: (orderNumber: string) => string;
    describeTake: (orderNumber: string) => string;
  },
): Promise<PointsRelease> {
  const [order, rows] = await Promise.all([
    tx.order.findUnique({
      where: { id: params.orderId },
      select: { userId: true, orderNumber: true },
    }),
    tx.pointTransaction.findMany({
      where: { orderId: params.orderId },
      select: { type: true, delta: true },
    }),
  ]);

  if (order === null || rows.length === 0) return { refunded: 0, reversed: 0 };

  const sumOf = (type: PointTransactionTypeCode) =>
    rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.delta, 0);

  let refunded = 0;
  let reversed = 0;

  const give = Math.max(0, params.give(-sumOf('REDEEM'), sumOf('REDEEM_REFUND')));

  if (give > 0) {
    const result = await postPointTransaction(tx, {
      userId: order.userId,
      type: 'REDEEM_REFUND',
      delta: give,
      description: params.describeGive(order.orderNumber),
      orderId: params.orderId,
      idempotencyKey: `${params.keyPrefix}:redeem-refund`,
    });
    if (result.posted) refunded = give;
  }

  const wanted = Math.max(0, params.take(sumOf('EARN'), -sumOf('EARN_REVERSAL')));

  if (wanted > 0) {
    // ล็อกแถวผู้ใช้ก่อนอ่านยอด — กันอีกคำสั่งซื้อหักแต้มไปตรงกลางระหว่างอ่านกับเขียน
    const locked = await tx.$queryRaw<{ points: number }[]>`
      SELECT "points" FROM "User" WHERE "id" = ${order.userId}::uuid FOR UPDATE`;
    const balance = Number(locked[0]?.points ?? 0);
    const take = Math.min(wanted, balance);
    const base = params.describeTake(order.orderNumber);

    const result = await postPointTransaction(tx, {
      userId: order.userId,
      type: 'EARN_REVERSAL',
      delta: -take,
      description:
        take === wanted
          ? base
          : `${base} — ควรหัก ${wanted.toLocaleString('th-TH')} แต้ม แต่แต้มถูกใช้ไปแล้ว จึงหักได้ ${take.toLocaleString('th-TH')} แต้ม`,
      orderId: params.orderId,
      idempotencyKey: `${params.keyPrefix}:earn-reversal`,
    });
    if (result.posted) reversed = take;
  }

  return { refunded, reversed };
}

/* ═══════════════════════ ฝั่งลูกค้า ═══════════════════════ */

export interface MyLoyaltyDto extends LoyaltyStandingDto {
  rules: LoyaltyRulesDto;
}

export async function getMyLoyalty(userId: string): Promise<MyLoyaltyDto> {
  const standing = await standingOf(getPrisma(), userId);

  return { ...standing, rules: loyaltyRules() };
}

export interface PointTransactionListDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TRANSACTION_SELECT = {
  id: true,
  type: true,
  delta: true,
  balanceAfter: true,
  description: true,
  createdAt: true,
  order: { select: { orderNumber: true } },
} as const satisfies Prisma.PointTransactionSelect;

/** ประวัติแต้มของผู้ใช้คนนี้เท่านั้น — กรอง `userId` เสมอ (ไม่มีทางเห็นของคนอื่น) */
export async function listMyPointTransactions(
  userId: string,
  query: { page: number; limit: number },
): Promise<PointTransactionListDto<PointTransactionDto>> {
  const prisma = getPrisma();
  const where = { userId };

  const [rows, total] = await Promise.all([
    prisma.pointTransaction.findMany({
      where,
      // เรียงตามลำดับที่เขียนจริง ไม่ใช่ createdAt — สองแถวในทรานแซกชันเดียวกันได้เวลาเท่ากันเป๊ะ
      // (ดูเหตุผลที่คอลัมน์ sequence ใน schema.prisma)
      orderBy: { sequence: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: TRANSACTION_SELECT,
    }),
    prisma.pointTransaction.count({ where }),
  ]);

  return {
    items: rows.map(toPointTransactionDto),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

/* ═══════════════════════ หลังบ้าน ═══════════════════════ */

export interface AdminPointTransactionDto extends PointTransactionDto {
  /** พนักงานที่ปรับแต้ม — null = ระบบทำเอง หรือบัญชีพนักงานถูกลบไปแล้ว */
  createdBy: { id: string; name: string | null; email: string } | null;
}

export async function adminListPointTransactions(
  userId: string,
  query: { page: number; limit: number },
): Promise<PointTransactionListDto<AdminPointTransactionDto> & { standing: LoyaltyStandingDto }> {
  const prisma = getPrisma();

  const exists = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });

  if (!exists) throw ApiError.notFound('ไม่พบบัญชีผู้ใช้นี้');

  const where = { userId };

  const [rows, total, standing] = await Promise.all([
    prisma.pointTransaction.findMany({
      where,
      orderBy: { sequence: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        ...TRANSACTION_SELECT,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.pointTransaction.count({ where }),
    standingOf(prisma, userId),
  ]);

  return {
    items: rows.map((row) => ({ ...toPointTransactionDto(row), createdBy: row.createdBy })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
    standing,
  };
}

export interface AdjustPointsResultDto {
  /** false = คำขอซ้ำ (idempotencyKey เดิม) จึงไม่ได้ปรับเพิ่ม */
  applied: boolean;
  standing: LoyaltyStandingDto;
}

/**
 * ร้านปรับแต้มให้ลูกค้าเอง (`loyalty:adjust` — ADMIN ขึ้นไป)
 *
 * - **ต้องกรอกเหตุผล** ซึ่งลูกค้าเห็นในประวัติแต้มของตัวเอง และเขียนลง AdminLog
 * - ปรับแต้มของตัวเองไม่ได้ · แตะได้แค่บัญชีที่บทบาทต่ำกว่า (ด่านเดียวกับการระงับบัญชี)
 * - หักได้ไม่เกินแต้มคงเหลือ (409) — ยอดติดลบไม่มีความหมาย และ CHECK ของฐานข้อมูลก็ไม่ยอม
 * - กดซ้ำด้วย `idempotencyKey` เดิมไม่ปรับซ้ำ (กฎเดียวกับการปรับสต็อกของ STEP 15 ข้อ 6)
 */
export async function adjustCustomerPoints(
  userId: string,
  input: AdjustPointsInput,
  actor: CustomerActor,
): Promise<AdjustPointsResultDto> {
  const prisma = getPrisma();

  const result = await prisma.$transaction(async (tx) => {
    await assertCanManage(tx, userId, actor);

    const posted = await postPointTransaction(tx, {
      userId,
      type: 'ADJUSTMENT',
      delta: input.delta,
      description:
        input.delta > 0 ? `ร้านเพิ่มแต้มให้: ${input.reason}` : `ร้านหักแต้ม: ${input.reason}`,
      createdById: actor.id,
      idempotencyKey: `adjust:${input.idempotencyKey}`,
      insufficientMessage: 'หักแต้มเกินยอดคงเหลือไม่ได้ — ดูยอดคงเหลือแล้วกรอกใหม่',
    });

    if (posted.posted) {
      // before/after คีย์ชุดเดียวกัน ไม่งั้นหน้าประวัติรายงานว่าช่องถูกล้างค่า (กฎ STEP 27)
      await writeAdminLog(tx, {
        actor,
        action: 'customer.points.adjust',
        targetType: 'User',
        targetId: userId,
        before: { points: posted.balanceBefore },
        after: { points: posted.balanceAfter, delta: input.delta, reason: input.reason },
      });
    }

    return posted;
  });

  if (result.posted) {
    await notifySafely(
      () =>
        notifyPointsAdjusted({
          userId,
          transactionId: result.transactionId,
          delta: result.delta,
          reason: input.reason,
          balanceAfter: result.balanceAfter,
        }),
      `loyalty:adjust:${result.transactionId}`,
    );
  }

  return { applied: result.posted, standing: await standingOf(prisma, userId) };
}
