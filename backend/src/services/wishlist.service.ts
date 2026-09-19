import { getPrisma, type Prisma } from '@teenstyle/database';

import { resolveProductPrice } from '../models/pricing.ts';
import {
  resolvePriceDrop,
  type WishlistItemDto,
  type WishlistListDto,
} from '../models/wishlist.model.ts';
import { PRODUCT_CARD_SELECT, toProductCards, type ProductCardRow } from './product.service.ts';
import { ApiError } from '../utils/api-error.ts';

/**
 * รายการที่ถูกใจ (STEP 22)
 *
 * ⚠️ `Wishlist.userId` เป็น non-nullable — รายการที่ถูกใจผูกกับบัญชีเสมอ ไม่มีแบบ guest
 *    ทุกคิวรีจึงต้องกรอง `userId` และคนอื่นดูของเราไม่ได้ (กฎเดียวกับ STEP 10 ข้อ 7)
 *
 * ⚠️ **ราคาทุกบาทคำนวณที่ server** — client ส่งได้แค่ `productId`
 *    `priceWhenAdded` อ่านจากฐานข้อมูลตอนกดถูกใจ ไม่ใช่ค่าที่ client แนบมา
 */

export type WishlistSort = 'newest' | 'price-drop' | 'price-asc' | 'price-desc';

export interface WishlistQuery {
  page: number;
  limit: number;
  sort: WishlistSort;
  /** true = แสดงเฉพาะรายการที่ราคาลดลงกว่าตอนกดถูกใจ */
  onlyPriceDrop: boolean;
}

/** สินค้าที่หน้าร้านมองเห็นเท่านั้น — ของที่ถูกลบหรือยังเป็นฉบับร่างห้ามโผล่ */
const STOREFRONT_PRODUCT_WHERE = {
  deletedAt: null,
  status: 'ACTIVE',
} as const satisfies Prisma.ProductWhereInput;

interface VariantFacts {
  activeVariantCount: number;
  quickAddVariantId: string | null;
}

/**
 * หา "ตัวเลือกเดียวที่กดซื้อได้ทันที" ของสินค้าหลายตัวในคิวรีเดียว
 *
 * ⚠️ ให้ `quickAddVariantId` เฉพาะเมื่อมีตัวเลือกที่ **ซื้อได้จริง** อยู่ตัวเดียวเท่านั้น
 *    ถ้ามีหลายสี/ไซซ์แล้วเราเลือกให้เอง ลูกค้าจะได้ของผิดโดยไม่รู้ตัว
 *    (กฎ "ห้ามเดาข้อมูลแทนผู้ใช้" — หลายตัวเลือกต้องพาไปเลือกที่หน้าสินค้า)
 *
 * จำนวนที่ซื้อได้จริงคิดแบบเดียวกับ [availability.ts](../models/availability.ts):
 * `quantity − reservedQuantity` และไม่ติดลบ
 */
async function getVariantFacts(productIds: string[]): Promise<Map<string, VariantFacts>> {
  const result = new Map<string, VariantFacts>();
  if (productIds.length === 0) return result;

  const rows = await getPrisma().productVariant.findMany({
    where: { productId: { in: productIds }, deletedAt: null, isActive: true },
    select: {
      id: true,
      productId: true,
      inventory: { select: { quantity: true, reservedQuantity: true } },
    },
  });

  for (const row of rows) {
    const current = result.get(row.productId) ?? { activeVariantCount: 0, quickAddVariantId: null };
    current.activeVariantCount += 1;
    result.set(row.productId, current);
  }

  // หา variant ที่ซื้อได้จริง แล้วให้ quick add เฉพาะสินค้าที่มีตัวเดียว
  const purchasable = new Map<string, string[]>();
  for (const row of rows) {
    const available = Math.max(
      0,
      (row.inventory?.quantity ?? 0) - (row.inventory?.reservedQuantity ?? 0),
    );
    if (available <= 0) continue;

    const list = purchasable.get(row.productId) ?? [];
    list.push(row.id);
    purchasable.set(row.productId, list);
  }

  for (const [productId, ids] of purchasable) {
    const facts = result.get(productId);
    if (facts && ids.length === 1) {
      facts.quickAddVariantId = ids[0]!;
    }
  }

  return result;
}

/** ลำดับการเรียงที่ฐานข้อมูลทำได้ — ส่วน `price-drop` ต้องเรียงใน TS เพราะต้องเทียบกับราคาปัจจุบัน */
function orderByOf(sort: WishlistSort): Prisma.WishlistOrderByWithRelationInput {
  switch (sort) {
    case 'price-asc':
      return { product: { price: 'asc' } };
    case 'price-desc':
      return { product: { price: 'desc' } };
    default:
      return { createdAt: 'desc' };
  }
}

/**
 * รายการที่ถูกใจของผู้ใช้คนหนึ่ง
 *
 * ดึงทั้งชุดมาก่อนแล้วค่อยแบ่งหน้าใน TS เพราะ
 *   1. ตัวกรอง/การเรียงแบบ "ราคาลด" ต้องเทียบ `priceWhenAdded` กับราคาปัจจุบัน
 *      ซึ่งราคาปัจจุบันคิดจากกฎใน `pricing.ts` (salePrice ?? price) ไม่ใช่คอลัมน์เดียว
 *   2. สรุปยอด (ราคาลดกี่ชิ้น · ของหมดกี่ชิ้น) ต้องนับจากทั้งชุด ไม่ใช่แค่หน้าปัจจุบัน
 * รายการที่ถูกใจเป็นของส่วนตัวและมีขนาดหลักสิบ–ร้อย จึงรับภาระนี้ได้
 * ถ้าโตกว่านั้นค่อยย้ายไปคิดด้วย SQL (นิพจน์ `COALESCE("salePrice","price")` เหมือน `/shop`)
 */
export async function listWishlist(userId: string, query: WishlistQuery): Promise<WishlistListDto> {
  const prisma = getPrisma();

  const rows = await prisma.wishlist.findMany({
    where: { userId, product: STOREFRONT_PRODUCT_WHERE },
    orderBy: orderByOf(query.sort),
    select: {
      id: true,
      createdAt: true,
      priceWhenAdded: true,
      notifyOnPriceDrop: true,
      product: { select: PRODUCT_CARD_SELECT },
    },
  });

  const cards = await toProductCards(rows.map((row) => row.product as ProductCardRow));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const variantFacts = await getVariantFacts(cards.map((card) => card.id));

  let items: WishlistItemDto[] = [];
  for (const row of rows) {
    const card = cardById.get(row.product.id);
    if (!card) continue;

    const facts = variantFacts.get(card.id) ?? { activeVariantCount: 0, quickAddVariantId: null };
    const priceWhenAdded = Number(String(row.priceWhenAdded));

    items.push({
      id: row.id,
      addedAt: row.createdAt.toISOString(),
      priceWhenAdded,
      notifyOnPriceDrop: row.notifyOnPriceDrop,
      priceDrop: resolvePriceDrop(priceWhenAdded, card.finalPrice),
      product: card,
      quickAddVariantId: facts.quickAddVariantId,
      activeVariantCount: facts.activeVariantCount,
    });
  }

  const summary = {
    total: items.length,
    priceDropCount: items.filter((item) => item.priceDrop !== null).length,
    outOfStockCount: items.filter((item) => item.product.stockStatus === 'OUT_OF_STOCK').length,
  };

  if (query.onlyPriceDrop) {
    items = items.filter((item) => item.priceDrop !== null);
  }

  if (query.sort === 'price-drop') {
    // ลดเยอะสุดขึ้นก่อน · รายการที่ไม่ได้ลดไปอยู่ท้ายโดยเรียงตามวันที่กดถูกใจ
    items.sort((a, b) => (b.priceDrop?.amount ?? -1) - (a.priceDrop?.amount ?? -1));
  }

  const total = items.length;
  const totalPages = Math.ceil(total / query.limit) || 1;
  const start = (query.page - 1) * query.limit;

  return {
    items: items.slice(start, start + query.limit),
    summary,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
}

/**
 * เพิ่มสินค้าเข้ารายการที่ถูกใจ
 *
 * กดซ้ำไม่เป็นไร — unique `[userId, productId]` ของฐานข้อมูลเป็นด่านจริง
 * และเราคืนรายการเดิมพร้อมบอกว่า `created = false` (ไม่เขียนทับ `priceWhenAdded` เดิม
 * เพราะจะทำให้ส่วนลดที่สะสมมาหายไป)
 */
export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<{ created: boolean; priceWhenAdded: number }> {
  const prisma = getPrisma();

  const product = await prisma.product.findFirst({
    where: { id: productId, ...STOREFRONT_PRODUCT_WHERE },
    select: { id: true, price: true, salePrice: true },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้าชิ้นนี้ หรือสินค้าไม่ได้เปิดขายอยู่');
  }

  // ราคาที่ต้องจ่ายจริง ณ ตอนนี้ — อ่านจากฐานข้อมูล ไม่ใช่ค่าที่ client ส่งมา
  const priceWhenAdded = resolveProductPrice(product).finalPrice;

  const existing = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { priceWhenAdded: true },
  });

  if (existing) {
    return { created: false, priceWhenAdded: Number(String(existing.priceWhenAdded)) };
  }

  try {
    await prisma.wishlist.create({
      data: { userId, productId, priceWhenAdded },
    });
    return { created: true, priceWhenAdded };
  } catch (err) {
    // กดรัว ๆ พร้อมกันสองคำขอ — อีกคำขอสร้างไปแล้ว ถือว่าสำเร็จ
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
      return { created: false, priceWhenAdded };
    }
    throw err;
  }
}

/**
 * เอาสินค้าออกจากรายการที่ถูกใจ
 *
 * กรอง `userId` เสมอ — ไม่เจอคืน 404 ไม่ใช่ 403 เพื่อไม่บอกใบ้ว่ามีแถวนั้นอยู่จริง
 */
export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<{ removed: boolean }> {
  const { count } = await getPrisma().wishlist.deleteMany({ where: { userId, productId } });

  if (count === 0) {
    throw ApiError.notFound('ไม่พบสินค้าชิ้นนี้ในรายการที่ถูกใจของคุณ');
  }

  return { removed: true };
}

/**
 * เปิด/ปิดการแจ้งเตือนเมื่อราคาลดของรายการหนึ่ง
 *
 * ⚠️ ตอนนี้บันทึกความต้องการไว้เท่านั้น **ยังไม่มีการส่งแจ้งเตือนจริง**
 *    เพราะยังไม่ได้ตั้งค่า SMTP (ดู [config/notification.ts](../config/notification.ts))
 *    หน้าเว็บต้องบอกตรง ๆ ว่าป้ายราคาลดบนหน้านี้คือช่องทางเดียวที่ใช้ได้ตอนนี้
 *    การส่งอีเมลจริงเป็นงานของ STEP 24/50
 */
export async function setPriceDropNotify(
  userId: string,
  productId: string,
  notifyOnPriceDrop: boolean,
): Promise<{ notifyOnPriceDrop: boolean }> {
  const { count } = await getPrisma().wishlist.updateMany({
    where: { userId, productId },
    data: { notifyOnPriceDrop },
  });

  if (count === 0) {
    throw ApiError.notFound('ไม่พบสินค้าชิ้นนี้ในรายการที่ถูกใจของคุณ');
  }

  return { notifyOnPriceDrop };
}

/**
 * สินค้าชิ้นไหนบ้างที่ผู้ใช้คนนี้กดถูกใจไว้แล้ว
 *
 * ใช้กับหน้าสินค้าเพื่อให้ปุ่มหัวใจแสดงสถานะถูกตั้งแต่ครั้งแรกที่เปิดหน้า
 * ไม่ล็อกอิน = ไม่มีรายการที่ถูกใจ จึงคืนเซ็ตว่างโดยไม่ต้องยิงฐานข้อมูล
 */
export async function findWishlistedProductIds(
  userId: string | undefined,
  productIds: string[],
): Promise<string[]> {
  if (!userId || productIds.length === 0) return [];

  const rows = await getPrisma().wishlist.findMany({
    where: { userId, productId: { in: productIds } },
    select: { productId: true },
  });

  return rows.map((row) => row.productId);
}
