import { getPrisma } from '@teenstyle/database';

import { availableOf, getAvailableStockByProduct } from '../models/availability.ts';
import { toProductCard, type ProductCardDto } from '../models/product.model.ts';

/**
 * Product service (STEP 5 — ใช้กับหน้าแรก · STEP 6 จะขยายเป็นหน้า /shop เต็มรูปแบบ)
 *
 * ทุก query กรอง `deletedAt: null` และ `status: 'ACTIVE'` เสมอ
 * เพราะสินค้าที่ถูก soft delete หรือยังเป็นฉบับร่างต้องไม่โผล่หน้าร้าน
 *
 * ⚠️ สถานะสต็อกบนการ์ดคิดจาก **จำนวนที่ขายได้จริง** (STEP 15) จึงต้องยิงคิวรีหาความพร้อมขาย
 *    เพิ่มอีกหนึ่งครั้งต่อรายการ — ห้ามกลับไปใช้ `Product.totalStock` เพราะมันไม่หักของที่จองไว้
 */

export type ProductSort = 'newest' | 'discount' | 'bestselling' | 'popular';

/** field ที่ต้อง select ให้ครบตามที่ mapper ต้องการ */
export const PRODUCT_CARD_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  shortDescription: true,
  price: true,
  salePrice: true,
  minimumStock: true,
  tags: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true } },
  // รูปหลักรูปเดียวพอสำหรับการ์ดสินค้า — เลี่ยงการโหลดรูปทั้งหมด (N+1 / payload บวม)
  images: {
    where: { isMain: true },
    select: { url: true, alt: true },
    take: 1,
  },
  _count: { select: { wishlist: true } },
} as const;

const STOREFRONT_WHERE = {
  deletedAt: null,
  status: 'ACTIVE',
} as const;

/** แถวที่ `PRODUCT_CARD_SELECT` คืนมา — ใช้ผูก type ของ mapper ให้ตรงกับ select */
export type ProductCardRow = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  price: unknown;
  salePrice: unknown;
  minimumStock: number;
  tags: string[];
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  images: { url: string; alt: string }[];
  _count?: { wishlist?: number };
};

/**
 * แปลงแถวสินค้าเป็นการ์ด พร้อมหา "จำนวนที่ขายได้จริง" ให้ทุกแถวในคิวรีเดียว (STEP 15)
 *
 * **ทุกที่ที่สร้างการ์ดสินค้าต้องผ่านฟังก์ชันนี้** ห้ามเรียก `toProductCard` ตรง ๆ
 * เพื่อไม่ให้มีทางลืมส่งค่าความพร้อมขาย แล้วสถานะสต็อกเพี้ยนเฉพาะบางหน้า
 */
export async function toProductCards(rows: ProductCardRow[]): Promise<ProductCardDto[]> {
  const available = await getAvailableStockByProduct(
    getPrisma(),
    rows.map((row) => row.id),
  );

  return rows.map((row) => toProductCard(row, availableOf(available, row.id)));
}

export interface ProductListResult {
  items: ProductCardDto[];
  /** เกณฑ์ที่ใช้จัดอันดับ — ส่งกลับให้ UI อธิบายผู้ใช้ได้ตรงความจริง */
  sort: ProductSort;
  total: number;
}

/** สินค้ามาใหม่ — เรียงตามวันที่เผยแพร่ */
async function findNewest(limit: number): Promise<ProductCardDto[]> {
  const rows = await getPrisma().product.findMany({
    where: STOREFRONT_WHERE,
    select: PRODUCT_CARD_SELECT,
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return toProductCards(rows);
}

/** Flash Sale — เฉพาะสินค้าที่มีราคาลดจริง เรียงจากลดมากไปน้อย */
async function findDiscounted(limit: number): Promise<ProductCardDto[]> {
  const rows = await getPrisma().product.findMany({
    where: { ...STOREFRONT_WHERE, salePrice: { not: null } },
    select: PRODUCT_CARD_SELECT,
    take: limit,
  });

  // เรียงตาม % ส่วนลดจริง ทำในโค้ดเพราะ Postgres เรียงตามนิพจน์ผ่าน Prisma ตรง ๆ ไม่ได้
  const cards = await toProductCards(rows);

  return cards.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
}

/**
 * สินค้าขายดี — นับจาก OrderItem จริงเท่านั้น
 *
 * ⚠️ ถ้ายังไม่มีคำสั่งซื้อในระบบ จะคืน array ว่าง **โดยเจตนา**
 *    ห้ามใส่ข้อมูลปลอมหรือสลับไปใช้เกณฑ์อื่นเงียบ ๆ เพราะจะกลายเป็นการโกหกผู้ใช้
 *    หน้าเว็บมี Empty State รองรับไว้แล้ว
 */
async function findBestSelling(limit: number): Promise<ProductCardDto[]> {
  const prisma = getPrisma();

  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    _sum: { quantity: true },
    where: {
      productId: { not: null },
      // นับเฉพาะออเดอร์ที่ชำระเงินแล้วและยังไม่ถูกยกเลิก
      order: {
        deletedAt: null,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
    },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  const productIds = grouped.map((row) => row.productId).filter((id): id is string => id !== null);

  if (productIds.length === 0) return [];

  const rows = await prisma.product.findMany({
    where: { ...STOREFRONT_WHERE, id: { in: productIds } },
    select: PRODUCT_CARD_SELECT,
  });

  // เรียงผลลัพธ์ตามอันดับยอดขาย (findMany ไม่รับประกันลำดับตาม in[])
  const rankByProductId = new Map(productIds.map((id, index) => [id, index]));
  const cards = await toProductCards(rows);

  return cards.sort((a, b) => (rankByProductId.get(a.id) ?? 0) - (rankByProductId.get(b.id) ?? 0));
}

/**
 * สินค้ายอดนิยม — จัดอันดับจากจำนวนคนกดถูกใจ แล้วตามด้วยจำนวนการเข้าชม
 *
 * ใช้เป็นฐานของ "แนะนำสำหรับคุณ" ในหน้าแรก
 * การแนะนำแบบเฉพาะบุคคลจริง (ดูจากประวัติของผู้ใช้แต่ละคน) จะทำใน STEP 46
 */
async function findPopular(limit: number): Promise<ProductCardDto[]> {
  const rows = await getPrisma().product.findMany({
    where: STOREFRONT_WHERE,
    select: PRODUCT_CARD_SELECT,
    orderBy: [{ wishlist: { _count: 'desc' } }, { viewCount: 'desc' }, { publishedAt: 'desc' }],
    take: limit,
  });

  return toProductCards(rows);
}

/** ทางเข้าเดียวของการดึงรายการสินค้าสำหรับหน้าร้าน */
export async function listProducts(sort: ProductSort, limit: number): Promise<ProductListResult> {
  const items = await (() => {
    switch (sort) {
      case 'newest':
        return findNewest(limit);
      case 'discount':
        return findDiscounted(limit);
      case 'bestselling':
        return findBestSelling(limit);
      case 'popular':
        return findPopular(limit);
    }
  })();

  return { items, sort, total: items.length };
}
