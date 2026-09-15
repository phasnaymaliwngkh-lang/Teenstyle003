import { randomBytes } from 'node:crypto';

import { getPrisma, Prisma } from '@teenstyle/database';

import { emptyCart, toCart, type CartDto } from '../models/cart.model.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';

/**
 * Cart service (STEP 9)
 *
 * กฎที่ห้ามละเมิด
 *   1. **ราคาคิดที่ server จากฐานข้อมูลทุกครั้ง** — client ส่งได้แค่ variantId + จำนวน
 *   2. **ห้ามเกินจำนวนที่ซื้อได้จริง** (`quantity − reservedQuantity`) และห้าม 0/ติดลบ
 *      ตรวจในทรานแซกชันเดียวกับการเขียน + มี CHECK constraint ที่ฐานข้อมูลเป็นด่านสุดท้าย
 *   3. **หนึ่ง variant = หนึ่งแถวต่อตะกร้า** (unique `[cartId, variantId]`) เพิ่มซ้ำให้บวกจำนวน
 *      → กันรายการซ้ำและกัน duplicate ตอนกดปุ่มรัว ๆ
 *   4. **ทุก mutation ต้องยืนยันว่ารายการนั้นอยู่ในตะกร้าของผู้เรียกเอง** (กัน IDOR)
 *   5. ตะกร้าไม่ใช่การจองของ — การจอง/ตัดสต็อกจริงเกิดตอนสั่งซื้อ (STEP 10/11)
 *      จึงยังต้องตรวจสต็อกซ้ำที่ checkout เสมอ
 */

/** เจ้าของตะกร้า — ผู้ใช้ที่ล็อกอิน หรือ guest ที่ถือ token ใน cookie */
export type CartOwner =
  { userId: string; guestToken?: undefined } | { userId?: undefined; guestToken: string };

/** อายุตะกร้าของ guest */
const GUEST_CART_DAYS = 30;

const CART_INCLUDE = {
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

const CART_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  ...CART_INCLUDE,
} as const satisfies Prisma.CartSelect;

/** token ของ guest ที่เดาไม่ได้ (ยาว 43 ตัวอักษร ผ่าน CHECK `Cart_guestToken_length`) */
export function createGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

function ownerWhere(owner: CartOwner): Prisma.CartWhereInput {
  return owner.userId !== undefined ? { userId: owner.userId } : { guestToken: owner.guestToken };
}

function guestExpiry(): Date {
  return new Date(Date.now() + GUEST_CART_DAYS * 24 * 60 * 60 * 1000);
}

/** อ่านตะกร้า — ถ้ายังไม่มีคืนตะกร้าเปล่า (ไม่สร้างแถวจากการแค่เปิดดู) */
export async function getCart(owner: CartOwner): Promise<CartDto> {
  const cart = await getPrisma().cart.findFirst({
    where: ownerWhere(owner),
    select: CART_SELECT,
  });

  if (!cart) return emptyCart(owner.userId === undefined);

  return toCart(cart);
}

/** ตะกร้าที่มีอยู่ หรือสร้างใหม่ถ้ายังไม่มี */
async function getOrCreateCartId(tx: Prisma.TransactionClient, owner: CartOwner): Promise<string> {
  const existing = await tx.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });
  if (existing) return existing.id;

  const created = await tx.cart.create({
    data:
      owner.userId !== undefined
        ? { userId: owner.userId }
        : { guestToken: owner.guestToken, expiresAt: guestExpiry() },
    select: { id: true },
  });

  return created.id;
}

/** ข้อมูล variant ที่ต้องใช้ตรวจก่อนเพิ่มลงตะกร้า */
async function loadPurchasableVariant(tx: Prisma.TransactionClient, variantId: string) {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, deletedAt: null, isActive: true },
    select: {
      id: true,
      price: true,
      salePrice: true,
      inventory: { select: { quantity: true, reservedQuantity: true } },
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          salePrice: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!variant || variant.product.deletedAt !== null || variant.product.status !== 'ACTIVE') {
    throw ApiError.notFound('ไม่พบสินค้าหรือตัวเลือกที่ระบุ');
  }

  const available = Math.max(
    0,
    (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
  );

  return { variant, available, price: resolveVariantPrice(variant, variant.product) };
}

/**
 * เพิ่มสินค้าลงตะกร้า — ถ้ามี variant นี้อยู่แล้วให้บวกจำนวน
 *
 * ทำในทรานแซกชันเดียว: อ่านสต็อก → ตรวจ → เขียน
 * ถ้ายอดรวมเกินที่ซื้อได้จริงจะไม่เขียนอะไรเลย และบอกจำนวนที่ยังเพิ่มได้
 */
export async function addItem(
  owner: CartOwner,
  variantId: string,
  quantity: number,
): Promise<CartDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const { available, price } = await loadPurchasableVariant(tx, variantId);

    if (available === 0) {
      throw ApiError.conflict('สินค้าตัวเลือกนี้หมดแล้ว');
    }

    const cartId = await getOrCreateCartId(tx, owner);
    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
      select: { id: true, quantity: true },
    });

    const currentQuantity = existing?.quantity ?? 0;
    const nextQuantity = currentQuantity + quantity;

    if (nextQuantity > available) {
      const remaining = Math.max(0, available - currentQuantity);
      throw ApiError.conflict(
        remaining === 0
          ? `มีสินค้านี้ในตะกร้าครบตามจำนวนที่มีอยู่แล้ว (${available} ชิ้น)`
          : `เพิ่มได้อีกไม่เกิน ${remaining} ชิ้น (ในคลังเหลือ ${available} ชิ้น)`,
      );
    }

    if (nextQuantity > 99) {
      throw ApiError.conflict('สั่งได้ไม่เกิน 99 ชิ้นต่อรายการ');
    }

    if (existing) {
      await tx.cartItem.update({
        where: { id: existing.id },
        // เลือกให้อัตโนมัติเมื่อผู้ใช้เพิ่มของชิ้นนี้อีก
        data: { quantity: nextQuantity, selected: true },
      });
    } else {
      await tx.cartItem.create({
        data: { cartId, variantId, quantity, addedPrice: price.finalPrice },
      });
    }
  });

  return getCart(owner);
}

/** หา cart item ของเจ้าของตะกร้านี้เท่านั้น (กัน IDOR) */
async function findOwnedItem(
  tx: Prisma.TransactionClient,
  owner: CartOwner,
  itemId: string,
): Promise<{ id: string; variantId: string; quantity: number }> {
  const item = await tx.cartItem.findFirst({
    where: { id: itemId, cart: ownerWhere(owner) },
    select: { id: true, variantId: true, quantity: true },
  });

  if (!item) {
    throw ApiError.notFound('ไม่พบรายการนี้ในตะกร้าของคุณ');
  }

  return item;
}

/** แก้จำนวนของรายการหนึ่ง — ตรวจสต็อกใหม่ทุกครั้ง */
export async function updateItemQuantity(
  owner: CartOwner,
  itemId: string,
  quantity: number,
): Promise<CartDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const item = await findOwnedItem(tx, owner, itemId);
    const { available } = await loadPurchasableVariant(tx, item.variantId);

    if (available === 0) {
      throw ApiError.conflict('สินค้าตัวเลือกนี้หมดแล้ว');
    }

    if (quantity > available) {
      throw ApiError.conflict(`สั่งได้ไม่เกิน ${available} ชิ้น (ตามจำนวนที่มีในคลัง)`);
    }

    await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
  });

  return getCart(owner);
}

/** ติ๊ก/เอาติ๊กออก เพื่อเลือกว่าจะสั่งรายการไหน */
export async function setItemSelected(
  owner: CartOwner,
  itemId: string,
  selected: boolean,
): Promise<CartDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const item = await findOwnedItem(tx, owner, itemId);
    await tx.cartItem.update({ where: { id: item.id }, data: { selected } });
  });

  return getCart(owner);
}

export async function removeItem(owner: CartOwner, itemId: string): Promise<CartDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const item = await findOwnedItem(tx, owner, itemId);
    await tx.cartItem.delete({ where: { id: item.id } });
  });

  return getCart(owner);
}

/** ล้างตะกร้า (ลบเฉพาะรายการ ไม่ลบใบตะกร้า) */
export async function clearCart(owner: CartOwner): Promise<CartDto> {
  const prisma = getPrisma();
  const cart = await prisma.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });

  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  return getCart(owner);
}

export interface AddLookResult {
  cart: CartDto;
  /** รายการที่เพิ่มไม่ได้ พร้อมเหตุผลที่ผู้ใช้อ่านรู้เรื่อง */
  skipped: { variantId: string; reason: string }[];
  addedCount: number;
}

/**
 * เพิ่มทั้งลุคลงตะกร้า (STEP 8 → 9)
 *
 * ตรวจเหมือน addItem ทุกข้อ + ต้องเป็น variant ของสินค้าที่อยู่ในลุคนั้นจริง
 * ชิ้นไหนเพิ่มไม่ได้จะถูกข้ามและรายงานกลับ — ไม่ล้มทั้งคำขอ
 * (ผู้ใช้จะได้ของที่เพิ่มได้ไปก่อน แล้วเห็นชัดว่าอะไรไม่ได้เพราะอะไร)
 */
export async function addLookToCart(
  owner: CartOwner,
  slug: string,
  selections: { variantId: string; quantity: number }[],
): Promise<AddLookResult> {
  const prisma = getPrisma();

  const look = await prisma.look.findFirst({
    where: { slug, deletedAt: null, isActive: true },
    select: {
      items: {
        where: { product: { deletedAt: null, status: 'ACTIVE' } },
        select: { productId: true },
      },
    },
  });

  if (!look) {
    throw ApiError.notFound('ไม่พบลุคที่ต้องการ');
  }

  const lookProductIds = new Set(look.items.map((item) => item.productId));
  const skipped: { variantId: string; reason: string }[] = [];
  let addedCount = 0;

  for (const selection of selections) {
    try {
      await prisma.$transaction(async (tx) => {
        const { variant, available, price } = await loadPurchasableVariant(tx, selection.variantId);

        if (!lookProductIds.has(variant.product.id)) {
          throw ApiError.badRequest('ตัวเลือกนี้ไม่ได้อยู่ในลุคนี้');
        }

        if (available === 0) {
          throw ApiError.conflict('สินค้าตัวเลือกนี้หมดแล้ว');
        }

        const cartId = await getOrCreateCartId(tx, owner);
        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId, variantId: selection.variantId } },
          select: { id: true, quantity: true },
        });

        const nextQuantity = (existing?.quantity ?? 0) + selection.quantity;

        if (nextQuantity > available || nextQuantity > 99) {
          throw ApiError.conflict(`เพิ่มได้ไม่เกิน ${Math.min(available, 99)} ชิ้น`);
        }

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: nextQuantity, selected: true },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId,
              variantId: selection.variantId,
              quantity: selection.quantity,
              addedPrice: price.finalPrice,
            },
          });
        }
      });

      addedCount += 1;
    } catch (error) {
      skipped.push({
        variantId: selection.variantId,
        reason: error instanceof ApiError ? error.message : 'เพิ่มลงตะกร้าไม่สำเร็จ',
      });
    }
  }

  return { cart: await getCart(owner), skipped, addedCount };
}

export interface MergeResult {
  cart: CartDto;
  /** จำนวนรายการที่ย้ายเข้ามาได้ */
  mergedCount: number;
  /** รายการที่ย้ายไม่ได้เพราะเกินสต็อกที่มี */
  clampedCount: number;
}

/**
 * รวมตะกร้าของ guest เข้าตะกร้าของผู้ใช้ตอนล็อกอิน (STEP 9)
 *
 * ทำทั้งหมดในทรานแซกชันเดียว:
 *   - variant ที่มีอยู่แล้วทั้งสองฝั่ง → บวกจำนวน แต่ **ไม่เกินที่ซื้อได้จริงและไม่เกิน 99**
 *   - variant ที่มีแต่ฝั่ง guest → ย้ายเข้ามา
 *   - จบแล้วลบตะกร้าของ guest ทิ้ง เพื่อไม่ให้รวมซ้ำได้อีก (idempotent)
 */
export async function mergeGuestCart(userId: string, guestToken: string): Promise<MergeResult> {
  const prisma = getPrisma();
  let mergedCount = 0;
  let clampedCount = 0;

  await prisma.$transaction(async (tx) => {
    const guestCart = await tx.cart.findUnique({
      where: { guestToken },
      select: {
        id: true,
        items: {
          select: { variantId: true, quantity: true, selected: true, addedPrice: true },
        },
      },
    });

    // ไม่มีตะกร้า guest หรือว่างเปล่า → ไม่ต้องทำอะไร (เรียกซ้ำได้ไม่มีผลข้างเคียง)
    if (!guestCart) return;

    if (guestCart.items.length > 0) {
      const userCartId = await getOrCreateCartId(tx, { userId });

      for (const item of guestCart.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: item.variantId, deletedAt: null, isActive: true },
          select: {
            inventory: { select: { quantity: true, reservedQuantity: true } },
            product: { select: { status: true, deletedAt: true } },
          },
        });

        if (!variant || variant.product.deletedAt !== null || variant.product.status !== 'ACTIVE') {
          clampedCount += 1;
          continue;
        }

        const available = Math.max(
          0,
          (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
        );

        if (available === 0) {
          clampedCount += 1;
          continue;
        }

        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId: userCartId, variantId: item.variantId } },
          select: { id: true, quantity: true },
        });

        const wanted = (existing?.quantity ?? 0) + item.quantity;
        const finalQuantity = Math.min(wanted, available, 99);

        if (finalQuantity < wanted) clampedCount += 1;

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: finalQuantity, selected: existing.quantity > 0 || item.selected },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: userCartId,
              variantId: item.variantId,
              quantity: finalQuantity,
              selected: item.selected,
              addedPrice: item.addedPrice,
            },
          });
        }

        mergedCount += 1;
      }
    }

    // ลบตะกร้า guest (items ถูกลบตาม onDelete: Cascade)
    await tx.cart.delete({ where: { id: guestCart.id } });
  });

  return { cart: await getCart({ userId }), mergedCount, clampedCount };
}
