import { getPrisma, Prisma } from '@teenstyle/database';

import type { ShippingMethodCode } from '../config/shipping.ts';
import { toCart, type CartItemDto } from '../models/cart.model.ts';
import {
  buildOrderNumber,
  ORDER_SHIPMENTS_SELECT,
  orderNumberPrefixFor,
  toOrder,
  type OrderDto,
} from '../models/order.model.ts';
import type { AppliedCouponDto } from '../models/coupon.model.ts';
import {
  loyaltyRules,
  toTierDto,
  tierForSpend,
  type LoyaltyRulesDto,
  type LoyaltyTierDto,
} from '../models/loyalty.model.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import {
  calculateShippingFee,
  isShippingAvailable,
  type ShippingOption,
} from '../models/shipping.model.ts';
import { checkCouponForCart, couponCartLinesOf, redeemCouponForOrder } from './coupon.service.ts';
import { evaluateRedemptionFor, lifetimeSpendOf, redeemPointsForOrder } from './loyalty.service.ts';
import { ApiError } from '../utils/api-error.ts';
import type { CreateOrderInput, NewAddressInput } from '../validators/order.validator.ts';

import { notifyOrderCreated, notifySafely } from './notification.service.ts';
import { activeShippingOptions, requireActiveShippingOption } from './shipping.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';
import { getStoreSettings } from './store-settings.service.ts';

/**
 * Order service (STEP 10 — Checkout)
 *
 * กฎที่ห้ามละเมิด
 *   1. **ยอดเงินทุกบาทคำนวณที่นี่จากฐานข้อมูล** — client ส่งได้แค่ที่อยู่ + วิธีจัดส่ง
 *   2. **ตรวจสต็อกใหม่ตอนสั่งซื้อ** ไม่เชื่อค่าที่แสดงในตะกร้า (ข้อมูลอาจเก่าไปหลายนาที)
 *   3. **จองสต็อกแบบ atomic**: `UPDATE … WHERE quantity - reserved >= qty`
 *      ถ้าไม่มีของพอ แถวจะไม่ถูกอัปเดต (rowCount = 0) → ทั้งทรานแซกชัน rollback
 *      กัน overselling ตอนคนสองคนกดพร้อมกันได้โดยไม่ต้องล็อกทั้งตาราง
 *      และมี CHECK `Inventory_reserved_not_over_quantity` เป็นด่านสุดท้ายที่ฐานข้อมูล
 *   4. **กันคำสั่งซื้อซ้ำด้วย `idempotencyKey`** (unique) — กดปุ่มรัว/retry ได้ออเดอร์เดิม
 *   5. **snapshot ทุกอย่างที่ลูกค้าเห็น** (ชื่อสินค้า ราคา ที่อยู่) ลงในออเดอร์
 *      ประวัติต้องไม่เปลี่ยนเมื่อสินค้าหรือที่อยู่ถูกแก้ภายหลัง
 *   6. STEP 10 **จองสต็อก ไม่ตัดสต็อก** — ตัดจริงตอนชำระเงินสำเร็จ (STEP 11)
 *      พร้อมบันทึก InventoryMovement เพื่อให้ตรวจย้อนหลังได้
 */

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discountTotal: true,
  // แต้มที่ใช้/ได้จากคำสั่งซื้อนี้ (STEP 42)
  pointsRedeemed: true,
  pointsDiscount: true,
  pointTransactions: { select: { type: true, delta: true } },
  refundedTotal: true,
  shippingFee: true,
  total: true,
  shippingMethod: true,
  shippingEtaText: true,
  addressSnapshot: true,
  customerNote: true,
  createdAt: true,
  paidAt: true,
  // timeline (STEP 12) — timestamp ของแต่ละขั้นที่เกิดขึ้นจริง
  processedAt: true,
  packedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  refundedAt: true,
  trackingNumber: true,
  shipments: ORDER_SHIPMENTS_SELECT,
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
      lineTotal: true,
      product: { select: { id: true, slug: true } },
    },
  },
} as const satisfies Prisma.OrderSelect;

const CART_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      quantity: true,
      selected: true,
      addedPrice: true,
      variant: {
        select: {
          id: true,
          sku: true,
          price: true,
          salePrice: true,
          isActive: true,
          deletedAt: true,
          color: { select: { name: true } },
          size: { select: { name: true } },
          inventory: { select: { quantity: true, reservedQuantity: true } },
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              salePrice: true,
              minimumStock: true,
              status: true,
              deletedAt: true,
              images: { where: { isMain: true }, select: { url: true, alt: true }, take: 1 },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.CartSelect;

const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  subDistrict: true,
  district: true,
  province: true,
  postalCode: true,
  country: true,
  isDefault: true,
} as const satisfies Prisma.AddressSelect;

export interface CheckoutAddressDto {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface ShippingOptionDto {
  code: ShippingMethodCode;
  name: string;
  description: string;
  etaText: string;
  /** ค่าส่งจริงของยอดสินค้าปัจจุบัน */
  fee: number;
  baseFee: number;
  /** ยอดที่ทำให้ส่งฟรี (null = ไม่มีโปร) */
  freeOverSubtotal: number | null;
  /** จำกัดเฉพาะจังหวัดเหล่านี้ (null = ทั่วประเทศ) — ส่งไปให้ฟอร์มตรวจสอบสด ๆ ได้ */
  onlyProvinces: string[] | null;
  /** เลือกได้ไหมสำหรับที่อยู่ที่ใช้อยู่ตอนนี้ */
  available: boolean;
  unavailableReason: string | null;
}

/** แต้มสะสมในหน้า checkout (STEP 42) — ทุกตัวเลขมาจาก server */
export interface CheckoutLoyaltyDto {
  /** แต้มคงเหลือในบัญชีตอนนี้ */
  balance: number;
  tier: LoyaltyTierDto;
  /** แต้มสูงสุดที่ใช้กับบิลนี้ได้ (คิดจากคูปองและวิธีจัดส่งที่ส่งมาในคำขอนี้) */
  maxRedeemablePoints: number;
  /** แต้มที่ใช้ได้จริงตามที่ขอ — 0 = ไม่ได้ใช้ หรือใช้ไม่ได้ (ดู error) */
  appliedPoints: number;
  /** มูลค่าส่วนลดจากแต้ม (บาท) — รวมอยู่ใน discountTotal แล้ว */
  pointsDiscount: number;
  /** เหตุผลที่ใช้แต้มตามที่ขอไม่ได้ — ต้องบอกผู้ใช้ ไม่ใช่เงียบแล้วไม่ลดให้ */
  error: string | null;
  rules: LoyaltyRulesDto;
}

export interface CheckoutSummaryDto {
  /** รายการที่ติ๊กเลือกไว้ในตะกร้า (ตรวจสต็อกใหม่แล้ว) */
  items: CartItemDto[];
  subtotal: number;
  /** ส่วนลดทั้งหมด (คูปอง + แต้ม) — ตัวเลขเดียวกับที่จะบันทึกลง Order.discountTotal */
  discountTotal: number;
  /** ส่วนลดจากคูปอง (รวมคูปองส่งฟรี) — แยกไว้ให้หน้าเว็บแสดงทีละบรรทัด */
  couponDiscount: number;
  shippingFee: number;
  total: number;
  /** คูปองที่ใช้ได้จริงกับตะกร้านี้ — null = ไม่ได้ใส่ หรือใส่แล้วใช้ไม่ได้ */
  appliedCoupon: AppliedCouponDto | null;
  /** เหตุผลที่คูปองที่กรอกมาใช้ไม่ได้ — ต้องบอกผู้ใช้ ไม่ใช่เงียบแล้วไม่ลดให้ */
  couponError: string | null;
  loyalty: CheckoutLoyaltyDto;
  selectedShippingMethod: ShippingMethodCode;
  shippingOptions: ShippingOptionDto[];
  addresses: CheckoutAddressDto[];
  /** เรื่องที่ต้องแก้ก่อนสั่งซื้อได้ */
  blockers: string[];
  checkoutReady: boolean;
}

/** ที่อยู่ที่ใช้คิดว่าวิธีจัดส่งไหนเลือกได้ (ใช้ที่อยู่เริ่มต้นถ้ามี) */
function provinceOf(addresses: CheckoutAddressDto[]): string | null {
  return addresses.find((address) => address.isDefault)?.province ?? addresses[0]?.province ?? null;
}

/**
 * วิธีจัดส่งที่ลูกค้าเลือกได้ — **เฉพาะที่ร้านเปิดใช้** (อัตราอ่านจากตาราง ShippingRate · STEP 44)
 * วิธีที่ร้านปิดไว้ไม่โผล่เลย ไม่ใช่โชว์แล้วกดไม่ได้ (ลูกค้าแก้อะไรไม่ได้อยู่ดี)
 */
function shippingOptionsFor(
  options: readonly ShippingOption[],
  subtotal: number,
  province: string | null,
): ShippingOptionDto[] {
  return options.map((option) => {
    const available = province === null ? true : isShippingAvailable(option, province);

    return {
      code: option.code,
      name: option.name,
      description: option.description,
      etaText: option.etaText,
      fee: calculateShippingFee(option, subtotal),
      baseFee: option.baseFee,
      freeOverSubtotal: option.freeOverSubtotal,
      onlyProvinces: option.onlyProvinces,
      available,
      unavailableReason: available
        ? null
        : `ยังไม่รองรับจังหวัด${province ?? ''} — เลือกวิธีอื่นได้`,
    };
  });
}

/** สรุปยอดสำหรับหน้า checkout — ตัวเลขทุกตัวมาจาก server */
export async function getCheckoutSummary(
  userId: string,
  shippingMethod: ShippingMethodCode,
  couponCode?: string,
  pointsToRedeem = 0,
): Promise<CheckoutSummaryDto> {
  const prisma = getPrisma();

  const [cart, addresses, lifetimeSpend, activeOptions] = await Promise.all([
    prisma.cart.findFirst({ where: { userId }, select: CART_SELECT }),
    prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: ADDRESS_SELECT,
    }),
    lifetimeSpendOf(prisma, userId),
    activeShippingOptions(prisma),
  ]);

  if (activeOptions.length === 0) {
    // ร้านปิดวิธีสุดท้ายไม่ได้ (adminUpdateShippingRate กันไว้) — เกิดได้เฉพาะตารางว่างจากการตั้งค่าผิด
    throw ApiError.conflict('ร้านยังไม่ได้เปิดวิธีจัดส่ง — ตอนนี้ยังสั่งซื้อไม่ได้');
  }

  const items = cart ? toCart(cart).items.filter((item) => item.selected) : [];
  const subtotal = items
    .filter((item) => item.issue === null)
    .reduce((sum, item) => sum + item.lineTotal, 0);

  const province = provinceOf(addresses);
  const options = shippingOptionsFor(activeOptions, subtotal, province);
  const chosen = options.find((option) => option.code === shippingMethod) ?? options[0]!;

  const blockers: string[] = [];
  if (items.length === 0) blockers.push('ยังไม่ได้เลือกสินค้าในตะกร้า');
  if (items.some((item) => item.issue !== null))
    blockers.push('มีสินค้าในตะกร้าที่ซื้อไม่ได้ — กลับไปแก้ที่หน้าตะกร้าก่อน');
  if (addresses.length === 0) blockers.push('ยังไม่มีที่อยู่จัดส่ง — กรอกที่อยู่ใหม่ได้ในหน้านี้');
  if (!chosen.available) blockers.push('วิธีจัดส่งที่เลือกใช้กับที่อยู่นี้ไม่ได้');

  /**
   * ส่วนลดคิดที่ `models/coupon.model.ts` ที่เดียว แล้ว **ยอดรวมทั้งคูปองส่วนลดและ
   * คูปองส่งฟรีถูกยุบลง `discountTotal` ตัวเดียว** เพราะสูตรของบิลคือ
   * `total = subtotal - discountTotal + shippingFee` (ตารางมีคอลัมน์ส่วนลดเดียว)
   * คูปองส่งฟรีจึงกลายเป็น discountTotal = ค่าจัดส่ง แล้วหักกันพอดี
   */
  let discountTotal = 0;
  let appliedCoupon: AppliedCouponDto | null = null;
  let couponError: string | null = null;

  if (couponCode !== undefined && couponCode !== '') {
    try {
      const result = await checkCouponForCart(userId, couponCode, chosen.code);

      if (result.applied !== null) {
        appliedCoupon = result.applied;
        discountTotal = result.evaluation.discountTotal + result.evaluation.shippingDiscount;
      } else {
        couponError = result.evaluation.message;
      }
    } catch (error) {
      // ไม่พบรหัส (404) ไม่ควรทำให้หน้าสรุปยอดพังทั้งหน้า — บอกเหตุผลแล้วคิดยอดตามปกติ
      couponError = error instanceof ApiError ? error.message : 'ใช้คูปองนี้ไม่ได้';
    }
  }

  /**
   * แต้มคิดหลังคูปองเสมอ — เพดานของแต้มคือยอดสินค้าที่ยังเหลือหลังหักคูปอง
   * (ส่วนลดทุกก้อนรวมกันต้องไม่เกินยอดสินค้า: CHECK Order_discount_not_over_subtotal)
   * กฎอยู่ที่ models/loyalty.model.ts ที่เดียว — ตัวเดียวกับที่ createOrder ใช้
   */
  const couponDiscount = discountTotal;
  const redemption = await evaluateRedemptionFor(prisma, {
    userId,
    requested: pointsToRedeem,
    subtotal,
    otherDiscount: couponDiscount,
  });
  const pointsDiscount = redemption.ok ? redemption.discount : 0;

  discountTotal = couponDiscount + pointsDiscount;

  return {
    items,
    subtotal,
    discountTotal,
    couponDiscount,
    appliedCoupon,
    couponError,
    loyalty: {
      balance: redemption.balance,
      tier: toTierDto(tierForSpend(lifetimeSpend)),
      maxRedeemablePoints: redemption.maxPoints,
      appliedPoints: redemption.ok ? redemption.points : 0,
      pointsDiscount,
      error: redemption.ok ? null : redemption.message,
      rules: loyaltyRules(),
    },
    shippingFee: chosen.fee,
    total: subtotal - discountTotal + chosen.fee,
    selectedShippingMethod: chosen.code,
    shippingOptions: options,
    addresses,
    // ที่อยู่ยังกรอกใหม่ในหน้านี้ได้ จึงไม่นับเป็นตัวบล็อกการกดปุ่ม
    blockers,
    checkoutReady: items.length > 0 && !items.some((item) => item.issue !== null),
  };
}

/**
 * สร้างเลขคำสั่งซื้อ (นับต่อวัน)
 *
 * รูปแบบอยู่ที่ [models/order.model.ts](../models/order.model.ts) ที่เดียว
 * เพราะฝั่ง AI ต้องอ่านเลขที่ลูกค้าพิมพ์มาด้วยรูปแบบเดียวกันนี้ (ดูเหตุผลในไฟล์นั้น)
 */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = orderNumberPrefixFor(now);
  const last = await tx.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  const lastSeq = last ? Number(last.orderNumber.slice(prefix.length)) : 0;
  const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;

  return buildOrderNumber(now, nextSeq);
}

/** ที่อยู่ที่จะใช้ส่งของ + แถวที่บันทึกไว้ (ถ้าผู้ใช้เลือกให้บันทึก) */
async function resolveAddress(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CreateOrderInput,
): Promise<{ addressId: string | null; snapshot: Record<string, string | null> }> {
  if (input.addressId !== undefined) {
    const address = await tx.address.findFirst({
      where: { id: input.addressId, userId, deletedAt: null },
      select: ADDRESS_SELECT,
    });

    if (!address) {
      throw ApiError.notFound('ไม่พบที่อยู่จัดส่งที่เลือก');
    }

    return { addressId: address.id, snapshot: snapshotOf(address) };
  }

  const fresh = input.newAddress as NewAddressInput;

  if (!fresh.saveForLater) {
    // ไม่บันทึกในสมุดที่อยู่ — ใช้ snapshot ในออเดอร์เท่านั้น (FK เป็น null ได้)
    return { addressId: null, snapshot: snapshotOf({ ...fresh, country: 'TH' }) };
  }

  const existingCount = await tx.address.count({ where: { userId, deletedAt: null } });
  const created = await tx.address.create({
    data: {
      userId,
      label: fresh.label ?? null,
      recipientName: fresh.recipientName,
      phone: fresh.phone,
      line1: fresh.line1,
      line2: fresh.line2 ?? null,
      subDistrict: fresh.subDistrict,
      district: fresh.district,
      province: fresh.province,
      postalCode: fresh.postalCode,
      // ที่อยู่แรกของบัญชีเป็นค่าเริ่มต้นให้เลย
      isDefault: existingCount === 0,
    },
    select: ADDRESS_SELECT,
  });

  return { addressId: created.id, snapshot: snapshotOf(created) };
}

function snapshotOf(address: {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country?: string;
}): Record<string, string | null> {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? null,
    subDistrict: address.subDistrict,
    district: address.district,
    province: address.province,
    postalCode: address.postalCode,
    country: address.country ?? 'TH',
  };
}

export interface CreateOrderResult {
  order: OrderDto;
  /** false = คำขอซ้ำ (idempotencyKey เดิม) จึงคืนออเดอร์เดิมโดยไม่สร้างใหม่ */
  created: boolean;
}

/**
 * สร้างคำสั่งซื้อจากรายการที่ติ๊กเลือกไว้ในตะกร้า
 *
 * ลำดับในทรานแซกชันเดียว (ล้มกลางทางแล้วไม่มีอะไรค้าง):
 *   ที่อยู่ → อ่านตะกร้า → ตรวจสินค้า/ราคาใหม่ → **จองสต็อกแบบ atomic**
 *   → สร้าง Order + OrderItem (snapshot) → ลบรายการที่สั่งแล้วออกจากตะกร้า
 */
export async function createOrder(
  userId: string,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const prisma = getPrisma();

  // คำขอซ้ำ → คืนออเดอร์เดิม ไม่สร้างใหม่ ไม่จองสต็อกเพิ่ม
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { ...ORDER_SELECT, userId: true },
  });

  if (existing) {
    if (existing.userId !== userId) {
      throw ApiError.forbidden('idempotencyKey นี้ถูกใช้กับบัญชีอื่นแล้ว');
    }

    return { order: toOrder(existing), created: false };
  }

  // เก็บไว้ตรวจเตือนสต็อกหลัง commit (STEP 16) — `ORDER_SELECT` ไม่มี variantId เพราะเป็น DTO ฝั่งลูกค้า
  let reservedVariantIds: string[] = [];

  const orderId = await prisma.$transaction(async (tx) => {
    const { addressId, snapshot } = await resolveAddress(tx, userId, input);

    // อัตราอ่านในทรานแซกชันนี้ — ชุดเดียวกับที่บันทึกลงคำสั่งซื้อ · ร้านปิดวิธีนี้แล้ว = 409 (STEP 44)
    const shipping = await requireActiveShippingOption(tx, input.shippingMethod);

    const province = typeof snapshot['province'] === 'string' ? snapshot['province'] : '';
    if (!isShippingAvailable(shipping, province)) {
      throw ApiError.badRequest(`วิธีจัดส่งที่เลือกใช้กับจังหวัด${province}ไม่ได้`);
    }

    const cart = await tx.cart.findFirst({ where: { userId }, select: CART_SELECT });
    const selected = (cart?.items ?? []).filter((item) => item.selected);

    if (selected.length === 0) {
      throw ApiError.badRequest('ไม่มีสินค้าที่เลือกไว้ในตะกร้า');
    }

    const orderItems: Prisma.OrderItemCreateManyOrderInput[] = [];
    let subtotal = 0;

    for (const item of selected) {
      const variant = item.variant;
      const product = variant.product;

      // ตรวจใหม่: สินค้าอาจถูกปิดขายหลังจากหยิบใส่ตะกร้า
      if (
        product.deletedAt !== null ||
        product.status !== 'ACTIVE' ||
        variant.deletedAt !== null ||
        !variant.isActive
      ) {
        throw ApiError.conflict(`"${product.name}" ไม่เปิดขายแล้ว — กรุณาลบออกจากตะกร้า`);
      }

      // จองสต็อกแบบ atomic: อัปเดตได้เฉพาะเมื่อของเหลือพอจริง
      const reserved = await tx.$executeRaw`
        UPDATE "Inventory"
           SET "reservedQuantity" = "reservedQuantity" + ${item.quantity}
         WHERE "variantId" = ${variant.id}::uuid
           AND "quantity" - "reservedQuantity" >= ${item.quantity}
      `;

      if (reserved === 0) {
        const available = Math.max(
          0,
          (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
        );
        throw ApiError.conflict(
          `"${product.name}" มีของไม่พอแล้ว (เหลือ ${available} ชิ้น) — กรุณาแก้จำนวนในตะกร้า`,
        );
      }

      // ราคาอ่านใหม่จากฐานข้อมูล ไม่ใช้ addedPrice ในตะกร้า
      const price = resolveVariantPrice(variant, product);
      const lineTotal = price.finalPrice * item.quantity;
      subtotal += lineTotal;

      orderItems.push({
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        variantSku: variant.sku,
        colorName: variant.color?.name ?? null,
        sizeName: variant.size?.name ?? null,
        imageUrl: product.images[0]?.url ?? null,
        unitPrice: price.finalPrice,
        quantity: item.quantity,
        lineTotal,
      });
    }

    const shippingFee = calculateShippingFee(shipping, subtotal);

    /**
     * ⚠️ ส่วนลดคิดใหม่ **ที่นี่** ด้วยข้อมูลในทรานแซกชันนี้ ไม่ใช่เชื่อยอดที่หน้าเว็บโชว์
     *    และการจองโควตาคูปองเป็น SQL เดียวแบบมีเงื่อนไข (ดู redeemCouponForOrder)
     *    ถ้าคูปองใช้ไม่ได้แล้ว → โยน error → ทรานแซกชัน rollback ทั้งก้อน
     *    ลูกค้าจะไม่ได้ออเดอร์ที่คิดส่วนลดผิด
     */
    let discountTotal = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;

    if (input.couponCode !== undefined && input.couponCode !== '') {
      const lines = await couponCartLinesOf(tx, userId);
      const redeemed = await redeemCouponForOrder(tx, {
        userId,
        code: input.couponCode,
        lines,
        shippingFee,
      });

      couponId = redeemed.couponId;
      couponCode = redeemed.couponCode;
      discountTotal = redeemed.evaluation.discountTotal + redeemed.evaluation.shippingDiscount;
    }

    /**
     * ⚠️ แต้มคิดใหม่ที่นี่จากแต้มคงเหลือในฐานข้อมูล ไม่ใช่เชื่อยอดที่หน้าเว็บโชว์ (STEP 42)
     *    ใช้ไม่ได้ → โยน 400 พร้อมเหตุผล → ทรานแซกชัน rollback ทั้งก้อน
     *    ห้ามลดจำนวนให้เงียบ ๆ เพราะยอดที่เก็บเงินจะไม่ตรงกับที่ลูกค้าเห็นตอนกดยืนยัน
     *    มูลค่าถูกยุบลง discountTotal (สูตรบิลมีช่องส่วนลดช่องเดียว — กฎ STEP 41 ข้อ 8)
     */
    let pointsRedeemed = 0;
    let pointsDiscount = 0;

    if (input.pointsToRedeem !== undefined && input.pointsToRedeem > 0) {
      const redemption = await evaluateRedemptionFor(tx, {
        userId,
        requested: input.pointsToRedeem,
        subtotal,
        otherDiscount: discountTotal,
      });

      if (!redemption.ok) {
        throw ApiError.badRequest(redemption.message ?? 'ใช้แต้มกับคำสั่งซื้อนี้ไม่ได้');
      }

      pointsRedeemed = redemption.points;
      pointsDiscount = redemption.discount;
      discountTotal += pointsDiscount;
    }

    const total = subtotal - discountTotal + shippingFee;

    /**
     * ⚠️ ยอดที่จะเก็บต้องเท่ากับยอดที่ลูกค้าเห็นตอนกดยืนยัน (STEP 44)
     *    ค่าส่งแก้ได้จากหลังบ้านแล้ว ราคาสินค้าและคูปองก็เปลี่ยนได้ระหว่างที่ลูกค้าเปิดหน้า checkout ค้างไว้
     *    → หน้าเว็บส่งยอดที่แสดงอยู่มา ถ้าไม่ตรงกับที่ server คิดได้ = ปฏิเสธ ไม่เก็บยอดใหม่เงียบ ๆ
     *    (server ไม่ได้ **ใช้** ค่านี้คิดเงิน — ใช้เทียบอย่างเดียว ยอดจริงยังคิดจากฐานข้อมูลทั้งหมด)
     *    เทียบเป็นสตางค์ (บทเรียนทศนิยมลอยของ STEP 42)
     */
    if (
      input.expectedTotal !== undefined &&
      Math.round(input.expectedTotal * 100) !== Math.round(total * 100)
    ) {
      const message = `ยอดรวมเปลี่ยนจากที่แสดง (เดิม ${input.expectedTotal.toLocaleString('th-TH')} บาท · ตอนนี้ ${total.toLocaleString('th-TH')} บาท) — ค่าส่ง ราคา หรือส่วนลดเพิ่งเปลี่ยน กรุณาตรวจยอดใหม่ก่อนกดสั่งซื้อ`;

      // `field` บอกหน้าเว็บว่าเป็นเรื่องยอดเปลี่ยน (โหลดยอดใหม่) ไม่ใช่ของหมด (กลับไปแก้ตะกร้า) — 409 เหมือนกัน
      throw ApiError.conflict(message, [{ field: 'expectedTotal', message }]);
    }

    const order = await tx.order.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        userId,
        subtotal,
        discountTotal,
        pointsRedeemed,
        pointsDiscount,
        shippingFee,
        total,
        couponId,
        // snapshot ของรหัสคูปอง — ประวัติต้องอ่านได้แม้คูปองถูกปิดใช้งานภายหลัง (กฎ STEP 10 ข้อ 5)
        couponCode,
        shippingMethod: input.shippingMethod,
        // ระยะเวลาที่ลูกค้าเห็นตอนสั่ง — ร้านแก้ข้อความนี้ได้ภายหลัง (กฎ STEP 10 ข้อ 5)
        shippingEtaText: shipping.etaText,
        // นโยบายคืนสินค้าที่ใช้ตอนสั่ง (STEP 49) — ร้านลดวันลงภายหลัง ใบนี้ยังได้ตามนี้
        returnWindowDays: (await getStoreSettings(tx)).returnWindowDays,
        shippingAddressId: addressId,
        addressSnapshot: snapshot,
        customerNote: input.customerNote ?? null,
        idempotencyKey: input.idempotencyKey,
        items: { createMany: { data: orderItems } },
      },
      select: { id: true, orderNumber: true },
    });

    // หักแต้มแบบ atomic หลังมีแถวออเดอร์ให้อ้างถึง — แต้มไม่พอแล้ว (ถูกใช้พร้อมกัน) → 409 → rollback
    await redeemPointsForOrder(tx, {
      userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      points: pointsRedeemed,
    });

    // ย้ายของออกจากตะกร้า (รายการที่ไม่ได้ติ๊กยังอยู่)
    await tx.cartItem.deleteMany({ where: { id: { in: selected.map((item) => item.id) } } });

    reservedVariantIds = selected.map((item) => item.variant.id);

    return order.id;
  });

  const created = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: ORDER_SELECT,
  });

  /**
   * การจองสต็อกทำให้ "จำนวนที่ขายได้จริง" ลดลงทันที แม้ของจะยังอยู่ในคลัง
   * → ต้องตรวจเตือนด้วย ไม่ใช่รอถึงตอนตัดสต็อก (STEP 16)
   */
  await scanAlertsAfterStockChange(reservedVariantIds);

  const order = toOrder(created);

  // แจ้งเตือนลูกค้าหลัง commit — ล้มแล้วต้องไม่ทำให้คำสั่งซื้อที่สำเร็จแล้วกลายเป็น error (STEP 24)
  await notifySafely(
    () => notifyOrderCreated({ userId, orderId, orderNumber: order.orderNumber }, order.total),
    `order:${orderId}:created`,
  );

  return { order, created: true };
}

/* ─── STEP 12: ประวัติและติดตามคำสั่งซื้อ ─────────────────────────────────── */

export interface OrderListResult {
  items: OrderDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** จำนวนออเดอร์แยกตามสถานะ — ใช้ทำแท็บกรอง (ตัวเลขตรงกับผลกรองจริง) */
  counts: { status: string; count: number }[];
}

/**
 * รายการคำสั่งซื้อของผู้ใช้คนนี้ (STEP 12)
 *
 * กรองตามสถานะที่ server ตรวจแล้วเท่านั้น และนับจำนวนจากฐานข้อมูลจริง
 * ⚠️ ทุก query กรอง `userId` เสมอ — ห้ามมีทางใดที่เห็นออเดอร์ของคนอื่น
 */
export async function listOrders(
  userId: string,
  query: { status?: string; page: number; limit: number },
): Promise<OrderListResult> {
  const prisma = getPrisma();

  const where: Prisma.OrderWhereInput = {
    userId,
    deletedAt: null,
    ...(query.status !== undefined ? { status: query.status as Prisma.EnumOrderStatusFilter } : {}),
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
    prisma.order.groupBy({
      by: ['status'],
      where: { userId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  return {
    items: rows.map(toOrder),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    counts: grouped.map((row) => ({ status: String(row.status), count: row._count._all })),
  };
}

/** คำสั่งซื้อของผู้ใช้คนนี้เท่านั้น (กันดูออเดอร์ของคนอื่น) */
export async function getOrderByNumber(userId: string, orderNumber: string): Promise<OrderDto> {
  const order = await getPrisma().order.findFirst({
    where: { orderNumber, userId, deletedAt: null },
    select: ORDER_SELECT,
  });

  if (!order) {
    throw ApiError.notFound('ไม่พบคำสั่งซื้อนี้');
  }

  return toOrder(order);
}
