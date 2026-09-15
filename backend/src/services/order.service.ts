import { getPrisma, Prisma } from '@teenstyle/database';

import {
  calculateShippingFee,
  isShippingAvailable,
  SHIPPING_OPTIONS,
  type ShippingMethodCode,
} from '../config/shipping.ts';
import { toCart, type CartItemDto } from '../models/cart.model.ts';
import { toOrder, type OrderDto } from '../models/order.model.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import type { CreateOrderInput, NewAddressInput } from '../validators/order.validator.ts';

import { scanAlertsAfterStockChange } from './stock-alert.service.ts';

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
  shippingFee: true,
  total: true,
  shippingMethod: true,
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
      product: { select: { slug: true } },
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

export interface CheckoutSummaryDto {
  /** รายการที่ติ๊กเลือกไว้ในตะกร้า (ตรวจสต็อกใหม่แล้ว) */
  items: CartItemDto[];
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
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

function shippingOptionsFor(subtotal: number, province: string | null): ShippingOptionDto[] {
  return SHIPPING_OPTIONS.map((option) => {
    const available = province === null ? true : isShippingAvailable(option.code, province);

    return {
      code: option.code,
      name: option.name,
      description: option.description,
      etaText: option.etaText,
      fee: calculateShippingFee(option.code, subtotal),
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
): Promise<CheckoutSummaryDto> {
  const prisma = getPrisma();

  const [cart, addresses] = await Promise.all([
    prisma.cart.findFirst({ where: { userId }, select: CART_SELECT }),
    prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: ADDRESS_SELECT,
    }),
  ]);

  const items = cart ? toCart(cart).items.filter((item) => item.selected) : [];
  const subtotal = items
    .filter((item) => item.issue === null)
    .reduce((sum, item) => sum + item.lineTotal, 0);

  const province = provinceOf(addresses);
  const options = shippingOptionsFor(subtotal, province);
  const chosen = options.find((option) => option.code === shippingMethod) ?? options[0]!;

  const blockers: string[] = [];
  if (items.length === 0) blockers.push('ยังไม่ได้เลือกสินค้าในตะกร้า');
  if (items.some((item) => item.issue !== null))
    blockers.push('มีสินค้าในตะกร้าที่ซื้อไม่ได้ — กลับไปแก้ที่หน้าตะกร้าก่อน');
  if (addresses.length === 0) blockers.push('ยังไม่มีที่อยู่จัดส่ง — กรอกที่อยู่ใหม่ได้ในหน้านี้');
  if (!chosen.available) blockers.push('วิธีจัดส่งที่เลือกใช้กับที่อยู่นี้ไม่ได้');

  const discountTotal = 0;

  return {
    items,
    subtotal,
    discountTotal,
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

/** สร้างเลขคำสั่งซื้อรูปแบบ TS-YYYYMMDD-#### (นับต่อวัน) */
async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  const prefix = `TS-${datePart}-`;
  const last = await tx.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  const lastSeq = last ? Number(last.orderNumber.slice(prefix.length)) : 0;
  const nextSeq = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
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

    const province = typeof snapshot['province'] === 'string' ? snapshot['province'] : '';
    if (!isShippingAvailable(input.shippingMethod, province)) {
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

    const shippingFee = calculateShippingFee(input.shippingMethod, subtotal);
    const discountTotal = 0;
    const total = subtotal - discountTotal + shippingFee;

    const order = await tx.order.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        userId,
        subtotal,
        discountTotal,
        shippingFee,
        total,
        shippingMethod: input.shippingMethod,
        shippingAddressId: addressId,
        addressSnapshot: snapshot,
        customerNote: input.customerNote ?? null,
        idempotencyKey: input.idempotencyKey,
        items: { createMany: { data: orderItems } },
      },
      select: { id: true },
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

  return { order: toOrder(created), created: true };
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
