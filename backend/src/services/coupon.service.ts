import { getPrisma, type Prisma } from '@teenstyle/database';

import type { ShippingMethodCode } from '../config/shipping.ts';
import { calculateShippingFee } from '../models/shipping.model.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import {
  evaluateCoupon,
  toAppliedCoupon,
  type AppliedCouponDto,
  type CouponCartLine,
  type CouponEvaluation,
  type CouponRow,
} from '../models/coupon.model.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  AdminCouponListQuery,
  CreateCouponInput,
  UpdateCouponInput,
} from '../validators/coupon.validator.ts';

import { loadShippingOptions } from './shipping.service.ts';

/**
 * คูปองส่วนลด (STEP 41)
 *
 * ⚠️ การคิดส่วนลดอยู่ที่ [models/coupon.model.ts](../models/coupon.model.ts) ที่เดียว
 *    ไฟล์นี้มีหน้าที่ **หาข้อมูลจริงมาป้อนให้มันคิด** และบันทึกผล
 */

const COUPON_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  type: true,
  value: true,
  minOrderAmount: true,
  maxDiscountAmount: true,
  usageLimit: true,
  usedCount: true,
  perUserLimit: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  products: { select: { id: true } },
  categories: { select: { id: true } },
} as const satisfies Prisma.CouponSelect;

type CouponWithScope = Prisma.CouponGetPayload<{ select: typeof COUPON_SELECT }>;

/** แถวที่อ่านจากฐานข้อมูล → รูปที่ตัวคิดส่วนลดต้องการ */
const toCouponRow = (coupon: CouponWithScope): CouponRow => ({
  id: coupon.id,
  code: coupon.code,
  name: coupon.name,
  type: coupon.type,
  value: coupon.value,
  minOrderAmount: coupon.minOrderAmount,
  maxDiscountAmount: coupon.maxDiscountAmount,
  usageLimit: coupon.usageLimit,
  usedCount: coupon.usedCount,
  perUserLimit: coupon.perUserLimit,
  startsAt: coupon.startsAt,
  endsAt: coupon.endsAt,
  isActive: coupon.isActive,
  products: coupon.products,
  categories: coupon.categories,
});

/**
 * รายการที่จะใช้คิดส่วนลด — อ่านจากตะกร้าของผู้ใช้เอง **ไม่ใช่จากค่าที่ client ส่งมา**
 *
 * นับเฉพาะรายการที่ติ๊กเลือกและซื้อได้จริง ให้ตรงกับยอดที่ checkout ใช้
 */
async function cartLinesOf(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  userId: string,
): Promise<CouponCartLine[]> {
  const items = await client.cartItem.findMany({
    where: { cart: { userId }, selected: true },
    select: {
      quantity: true,
      variant: {
        select: {
          price: true,
          salePrice: true,
          isActive: true,
          deletedAt: true,
          inventory: { select: { quantity: true, reservedQuantity: true } },
          product: {
            select: {
              id: true,
              categoryId: true,
              price: true,
              salePrice: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  const lines: CouponCartLine[] = [];

  for (const item of items) {
    const { variant } = item;
    const { product } = variant;
    const sellable =
      variant.isActive &&
      variant.deletedAt === null &&
      product.deletedAt === null &&
      product.status === 'ACTIVE';

    if (!sellable) continue;

    const available = Math.max(
      0,
      (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
    );

    if (available < item.quantity) continue;

    const price = resolveVariantPrice(variant, product);

    lines.push({
      productId: product.id,
      categoryId: product.categoryId,
      lineTotal: price.finalPrice * item.quantity,
    });
  }

  return lines;
}

/** จำนวนครั้งที่ผู้ใช้คนนี้ใช้คูปองนี้ไปแล้ว — นับจากคำสั่งซื้อที่ยังไม่ถูกยกเลิก */
function countUserUsage(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  couponId: string,
  userId: string,
): Promise<number> {
  return client.order.count({
    where: { couponId, userId, status: { notIn: ['CANCELLED'] } },
  });
}

async function findActiveCoupon(
  client: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  code: string,
): Promise<CouponWithScope | null> {
  return client.coupon.findFirst({
    where: { code, deletedAt: null },
    select: COUPON_SELECT,
  });
}

export interface CouponCheckResult {
  applied: AppliedCouponDto | null;
  evaluation: CouponEvaluation;
}

/**
 * ตรวจคูปองกับตะกร้าจริงของผู้ใช้ (ใช้ตอนกรอกรหัสและตอนสรุปยอด)
 *
 * ไม่พบรหัส → โยน 404 เพื่อให้หน้าเว็บบอกว่า "ไม่พบคูปองนี้"
 * พบแต่ใช้ไม่ได้ → **ไม่โยน** แต่คืนเหตุผลมา เพราะผู้ใช้ต้องรู้ว่าติดเงื่อนไขข้อไหน
 */
export async function checkCouponForCart(
  userId: string,
  code: string,
  shippingMethod: ShippingMethodCode,
): Promise<CouponCheckResult> {
  const prisma = getPrisma();
  const coupon = await findActiveCoupon(prisma, code);

  if (coupon === null) throw ApiError.notFound('ไม่พบคูปองนี้ — ตรวจตัวสะกดอีกครั้ง');

  const lines = await cartLinesOf(prisma, userId);
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const userUsedCount = await countUserUsage(prisma, coupon.id, userId);

  // ค่าส่งชุดเดียวกับที่หน้า checkout และการสร้างคำสั่งซื้อใช้ (ตาราง ShippingRate · STEP 44)
  const shipping = (await loadShippingOptions(prisma)).find(
    (option) => option.code === shippingMethod,
  );

  if (shipping === undefined) throw ApiError.conflict('ไม่พบวิธีจัดส่งที่เลือก');

  const evaluation = evaluateCoupon({
    coupon: toCouponRow(coupon),
    lines,
    shippingFee: calculateShippingFee(shipping, subtotal),
    userUsedCount,
    now: new Date(),
  });

  return {
    applied: evaluation.ok ? toAppliedCoupon(coupon, evaluation) : null,
    evaluation,
  };
}

/**
 * ใช้คูปองตอนสร้างคำสั่งซื้อจริง — เรียกจาก **ในทรานแซกชันเดียวกับการสร้างออเดอร์**
 *
 * ⚠️ การจองโควตาต้องเป็น SQL เดียวแบบมีเงื่อนไข ห้ามอ่านแล้วค่อยเขียน
 *    ไม่งั้นสองคนใช้คูปองใบสุดท้ายพร้อมกันแล้วเกินโควตาทั้งคู่
 *    (แพตเทิร์นเดียวกับการจองสต็อกของ STEP 10 ข้อ 2)
 */
export async function redeemCouponForOrder(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    code: string;
    lines: CouponCartLine[];
    shippingFee: number;
  },
): Promise<{ couponId: string; couponCode: string; evaluation: CouponEvaluation }> {
  const coupon = await findActiveCoupon(tx, params.code);

  if (coupon === null) throw ApiError.badRequest('ไม่พบคูปองนี้ — ตรวจตัวสะกดอีกครั้ง');

  const userUsedCount = await countUserUsage(tx, coupon.id, params.userId);
  const evaluation = evaluateCoupon({
    coupon: toCouponRow(coupon),
    lines: params.lines,
    shippingFee: params.shippingFee,
    userUsedCount,
    now: new Date(),
  });

  if (!evaluation.ok) {
    throw ApiError.badRequest(evaluation.message ?? 'ใช้คูปองนี้กับคำสั่งซื้อนี้ไม่ได้');
  }

  /**
   * จองโควตาแบบ atomic — `rowCount = 0` แปลว่ามีคนใช้ครบไปก่อนเรา
   * `usageLimit IS NULL` = ไม่จำกัด แต่ยังต้องบวกตัวนับเพื่อให้รายงานถูก
   */
  const reserved = await tx.$executeRaw`
    UPDATE "Coupon"
       SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
     WHERE "id" = ${coupon.id}::uuid
       AND "deletedAt" IS NULL
       AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;

  if (reserved === 0) {
    throw ApiError.conflict('คูปองนี้ถูกใช้ครบจำนวนที่กำหนดแล้ว');
  }

  return { couponId: coupon.id, couponCode: coupon.code, evaluation };
}

/** คืนโควตาเมื่อคำสั่งซื้อถูกยกเลิก — ห้ามให้ตัวนับค้างสูงกว่าการใช้จริง */
export async function releaseCouponForOrder(
  tx: Prisma.TransactionClient,
  couponId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Coupon"
       SET "usedCount" = GREATEST("usedCount" - 1, 0), "updatedAt" = now()
     WHERE "id" = ${couponId}::uuid`;
}

/**
 * คืนโควตาคูปองของคำสั่งซื้อที่ถูกยกเลิก — เรียกคู่กับการคืนสต็อกทุกที่
 *
 * หา `couponId` เองจาก orderId เพื่อให้ผู้เรียกไม่ต้องแก้ `select` ของตัวเอง
 * ⚠️ ถ้าไม่คืน ตัวนับ `usedCount` จะค้างสูงกว่าการใช้จริง แล้วคูปองจะ "เต็ม"
 *    ทั้งที่ยังไม่มีใครได้ใช้ — ลูกค้าถูกปฏิเสธด้วยเหตุผลที่ไม่จริง
 */
export async function releaseCouponForCancelledOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { couponId: true },
  });

  if (order?.couponId) await releaseCouponForOrder(tx, order.couponId);
}

/** รายการที่จะใช้คิดส่วนลด สำหรับผู้เรียกที่อยู่ในทรานแซกชันแล้ว */
export const couponCartLinesOf = cartLinesOf;

/* ═══════════════════════ หลังบ้าน ═══════════════════════ */

export interface AdminCouponDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  value: number;
  minOrderAmount: number | null;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  /** สถานะที่คำนวณสด ๆ จากเวลาและตัวนับ — ไม่เก็บเป็นคอลัมน์ */
  state: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'INACTIVE' | 'USED_UP';
  productIds: string[];
  categoryIds: string[];
  createdAt: string;
}

function couponState(coupon: CouponWithScope, now: Date): AdminCouponDto['state'] {
  if (!coupon.isActive) return 'INACTIVE';
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return 'USED_UP';
  if (now < coupon.startsAt) return 'SCHEDULED';
  if (now > coupon.endsAt) return 'EXPIRED';

  return 'ACTIVE';
}

const decimal = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

function toAdminCoupon(coupon: CouponWithScope, now: Date): AdminCouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    description: coupon.description,
    type: coupon.type,
    value: Number(coupon.value),
    minOrderAmount: decimal(coupon.minOrderAmount),
    maxDiscountAmount: decimal(coupon.maxDiscountAmount),
    usageLimit: coupon.usageLimit,
    usedCount: coupon.usedCount,
    perUserLimit: coupon.perUserLimit,
    startsAt: coupon.startsAt.toISOString(),
    endsAt: coupon.endsAt.toISOString(),
    isActive: coupon.isActive,
    state: couponState(coupon, now),
    productIds: coupon.products.map((product) => product.id),
    categoryIds: coupon.categories.map((category) => category.id),
    createdAt: coupon.createdAt.toISOString(),
  };
}

export async function listCoupons(query: AdminCouponListQuery): Promise<{
  items: AdminCouponDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const prisma = getPrisma();
  const now = new Date();

  /**
   * กรองสถานะใน SQL **ก่อนแบ่งหน้า** ไม่ใช่กรองเฉพาะแถวที่หยิบมา
   * ไม่งั้นจำนวนที่แสดงไม่ตรงกับแถวที่เห็น (บั๊กชนิดเดียวกับตัวกรองสต็อกต่ำของ STEP 14 ข้อ 7)
   */
  const stateWhere: Record<AdminCouponListQuery['status'], Prisma.CouponWhereInput> = {
    ALL: {},
    ACTIVE: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    SCHEDULED: { isActive: true, startsAt: { gt: now } },
    EXPIRED: { endsAt: { lt: now } },
    INACTIVE: { isActive: false },
  };

  const where: Prisma.CouponWhereInput = {
    deletedAt: null,
    ...stateWhere[query.status],
    ...(query.q
      ? {
          OR: [
            { code: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.coupon.count({ where }),
    prisma.coupon.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: COUPON_SELECT,
    }),
  ]);

  return {
    items: rows.map((row) => toAdminCoupon(row, now)),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

/** แปลง P2002 ของรหัสซ้ำให้เป็น 409 ไม่ใช่ 500 */
function rethrowDuplicateCode(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  ) {
    throw ApiError.conflict('รหัสคูปองนี้ถูกใช้แล้ว — ใช้รหัสอื่น');
  }

  throw error;
}

export async function createCoupon(
  input: CreateCouponInput,
  actor: AdminLogActor,
): Promise<AdminCouponDto> {
  const prisma = getPrisma();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          value: input.value,
          minOrderAmount: input.minOrderAmount ?? null,
          maxDiscountAmount: input.maxDiscountAmount ?? null,
          usageLimit: input.usageLimit ?? null,
          perUserLimit: input.perUserLimit ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          isActive: input.isActive,
          products: { connect: input.productIds.map((id) => ({ id })) },
          categories: { connect: input.categoryIds.map((id) => ({ id })) },
        },
        select: COUPON_SELECT,
      });

      await writeAdminLog(tx, {
        actor,
        action: 'coupon.create',
        targetType: 'Coupon',
        targetId: coupon.id,
        after: { code: coupon.code, type: coupon.type, value: Number(coupon.value) },
      });

      return coupon;
    });

    return toAdminCoupon(created, new Date());
  } catch (error) {
    rethrowDuplicateCode(error);
  }
}

export async function updateCoupon(
  couponId: string,
  input: UpdateCouponInput,
  actor: AdminLogActor,
): Promise<AdminCouponDto> {
  const prisma = getPrisma();

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.coupon.findFirst({
        where: { id: couponId, deletedAt: null },
        select: COUPON_SELECT,
      });

      if (existing === null) throw ApiError.notFound('ไม่พบคูปองนี้');

      /**
       * ⚠️ `before` ต้องมีคีย์ชุดเดียวกับ `after` ไม่งั้นหน้าประวัติจะรายงานว่า
       *    "ช่องนี้ถูกล้างค่า" ทั้งที่ไม่มีใครแตะ (บทเรียนจาก STEP 27)
       */
      const before: Record<string, string | number | boolean | null> = {};
      const after: Record<string, string | number | boolean | null> = {};
      const track = (
        key: string,
        previous: string | number | boolean | null,
        next: string | number | boolean | null | undefined,
      ) => {
        if (next === undefined) return;
        before[key] = previous;
        after[key] = next;
      };

      track('code', existing.code, input.code);
      track('name', existing.name, input.name);
      track('type', existing.type, input.type);
      track('value', Number(existing.value), input.value);
      track('minOrderAmount', decimal(existing.minOrderAmount), input.minOrderAmount);
      track('maxDiscountAmount', decimal(existing.maxDiscountAmount), input.maxDiscountAmount);
      track('usageLimit', existing.usageLimit, input.usageLimit);
      track('perUserLimit', existing.perUserLimit, input.perUserLimit);
      track('isActive', existing.isActive, input.isActive);
      track('startsAt', existing.startsAt.toISOString(), input.startsAt);
      track('endsAt', existing.endsAt.toISOString(), input.endsAt);

      const coupon = await tx.coupon.update({
        where: { id: couponId },
        data: {
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.minOrderAmount !== undefined ? { minOrderAmount: input.minOrderAmount } : {}),
          ...(input.maxDiscountAmount !== undefined
            ? { maxDiscountAmount: input.maxDiscountAmount }
            : {}),
          ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
          ...(input.perUserLimit !== undefined ? { perUserLimit: input.perUserLimit } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
          ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
          ...(input.productIds !== undefined
            ? { products: { set: input.productIds.map((id) => ({ id })) } }
            : {}),
          ...(input.categoryIds !== undefined
            ? { categories: { set: input.categoryIds.map((id) => ({ id })) } }
            : {}),
        },
        select: COUPON_SELECT,
      });

      await writeAdminLog(tx, {
        actor,
        action: 'coupon.update',
        targetType: 'Coupon',
        targetId: coupon.id,
        before,
        after,
      });

      return coupon;
    });

    return toAdminCoupon(updated, new Date());
  } catch (error) {
    rethrowDuplicateCode(error);
  }
}

/**
 * ปิดใช้งานคูปอง = soft delete
 *
 * ลบถาวรไม่ได้ เพราะ `Order.couponId` ยังอ้างถึงแถวนี้ และประวัติต้องอธิบายได้ว่า
 * คำสั่งซื้อเก่าได้ส่วนลดจากคูปองใบไหน (แพตเทิร์นเดียวกับการลบสินค้าของ STEP 14 ข้อ 2)
 */
export async function deleteCoupon(couponId: string, actor: AdminLogActor): Promise<void> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.coupon.findFirst({
      where: { id: couponId, deletedAt: null },
      select: { id: true, code: true, isActive: true },
    });

    if (existing === null) throw ApiError.notFound('ไม่พบคูปองนี้');

    await tx.coupon.update({
      where: { id: couponId },
      data: { isActive: false, deletedAt: new Date() },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'coupon.delete',
      targetType: 'Coupon',
      targetId: existing.id,
      before: { code: existing.code, isActive: existing.isActive },
      after: { code: existing.code, isActive: false },
    });
  });
}
