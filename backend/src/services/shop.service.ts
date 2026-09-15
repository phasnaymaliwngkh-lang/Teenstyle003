import { getPrisma, Prisma } from '@teenstyle/database';

import { resolveVariantPrice } from '../models/pricing.ts';
import { toProductDetail, type ProductDetailDto } from '../models/product-detail.model.ts';
import { toProductCard, type ProductCardDto } from '../models/product.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type { ShopQuery } from '../validators/product.validator.ts';

import { PRODUCT_CARD_SELECT } from './product.service.ts';

/**
 * Shop service (STEP 6) — ค้นหา/กรอง/เรียง/แบ่งหน้า + รายละเอียดสินค้า + ตรวจสต็อก
 *
 * ทำไมใช้ raw SQL ในการกรองและเรียง
 *   ราคาที่ลูกค้าจ่ายจริงคือ COALESCE(salePrice, price) ซึ่งเป็น "นิพจน์"
 *   Prisma orderBy/where ทำกับนิพจน์ไม่ได้ ถ้าเรียงด้วย price เฉย ๆ ลำดับจะผิดทันที
 *   ที่สินค้าลดราคา จึงใช้ SQL ดึง id ที่เรียงแล้ว + จำนวนรวม แล้วค่อยให้ Prisma
 *   ดึงข้อมูลเต็มของ id เหล่านั้น (ได้ทั้งความถูกต้องและ type safety)
 *
 * ทุกค่าที่มาจากผู้ใช้ถูกส่งผ่าน parameter ของ Prisma.sql (กัน SQL injection)
 * ส่วน ORDER BY ใช้ค่าที่ผ่าน Zod enum มาแล้วเท่านั้น จึงไม่มีทางเป็นค่าอื่น
 */

export interface ShopResult {
  items: ProductCardDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** ส่งกลับ filter ที่ใช้จริง เพื่อให้ UI แสดงสถานะได้ตรง */
  appliedSort: ShopQuery['sort'];
}

/** นิพจน์ราคาที่ลูกค้าจ่ายจริง */
const EFFECTIVE_PRICE = Prisma.sql`COALESCE(p."salePrice", p."price")`;

/** ORDER BY ตาม sort ที่ผ่าน validation มาแล้ว (whitelist — ไม่รับค่าอื่น) */
function orderByFragment(sort: ShopQuery['sort']): Prisma.Sql {
  switch (sort) {
    case 'price-asc':
      return Prisma.sql`${EFFECTIVE_PRICE} ASC, p."createdAt" DESC`;
    case 'price-desc':
      return Prisma.sql`${EFFECTIVE_PRICE} DESC, p."createdAt" DESC`;
    case 'discount':
      return Prisma.sql`
        CASE WHEN p."salePrice" IS NULL OR p."price" = 0 THEN 0
             ELSE (p."price" - p."salePrice") / p."price" END DESC,
        p."createdAt" DESC`;
    case 'popular':
      return Prisma.sql`
        (SELECT count(*) FROM "Wishlist" w WHERE w."productId" = p.id) DESC,
        p."viewCount" DESC,
        p."publishedAt" DESC NULLS LAST`;
    case 'bestselling':
      return Prisma.sql`
        (SELECT COALESCE(sum(oi."quantity"), 0)
           FROM "OrderItem" oi
           JOIN "Order" o ON o.id = oi."orderId"
          WHERE oi."productId" = p.id
            AND o."deletedAt" IS NULL
            AND o."paymentStatus" = 'PAID'
            AND o."status" NOT IN ('CANCELLED', 'REFUNDED')) DESC,
        p."publishedAt" DESC NULLS LAST`;
    case 'newest':
      return Prisma.sql`p."publishedAt" DESC NULLS LAST, p."createdAt" DESC`;
  }
}

/** ค้นหาสินค้าตามเงื่อนไข */
export async function searchProducts(query: ShopQuery): Promise<ShopResult> {
  const prisma = getPrisma();
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p."deletedAt" IS NULL`,
    Prisma.sql`p."status" = 'ACTIVE'`,
  ];

  if (query.q) {
    // ILIKE ใช้ GIN index (pg_trgm) ที่สร้างไว้ใน STEP 2
    const pattern = `%${query.q}%`;
    conditions.push(
      Prisma.sql`(p."name" ILIKE ${pattern} OR p."sku" ILIKE ${pattern} OR ${query.q} = ANY(p."tags"))`,
    );
  }

  if (query.category) {
    // รวมสินค้าในหมวดย่อยด้วย เพื่อให้ตัวเลขตรงกับที่แสดงในหน้าแรก
    conditions.push(Prisma.sql`p."categoryId" IN (
      SELECT c.id FROM "Category" c
      WHERE c."deletedAt" IS NULL
        AND (c."slug" = ${query.category}
             OR c."parentId" = (SELECT id FROM "Category" WHERE "slug" = ${query.category}))
    )`);
  }

  if (query.brand && query.brand.length > 0) {
    conditions.push(
      Prisma.sql`p."brandId" IN (SELECT id FROM "Brand" WHERE "slug" IN (${Prisma.join(query.brand)}))`,
    );
  }

  if (query.minPrice !== undefined) {
    conditions.push(Prisma.sql`${EFFECTIVE_PRICE} >= ${query.minPrice}`);
  }
  if (query.maxPrice !== undefined) {
    conditions.push(Prisma.sql`${EFFECTIVE_PRICE} <= ${query.maxPrice}`);
  }

  if (query.inStock) {
    conditions.push(Prisma.sql`p."totalStock" > 0`);
  }
  if (query.onSale) {
    conditions.push(Prisma.sql`p."salePrice" IS NOT NULL`);
  }

  // ไซซ์/สี อยู่ที่ระดับ variant จึงต้องใช้ EXISTS
  if (query.size && query.size.length > 0) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      JOIN "Size" s ON s.id = v."sizeId"
      WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v."isActive"
        AND s."code" IN (${Prisma.join(query.size)})
    )`);
  }
  if (query.color && query.color.length > 0) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" v
      JOIN "Color" c2 ON c2.id = v."colorId"
      WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v."isActive"
        AND c2."slug" IN (${Prisma.join(query.color)})
    )`);
  }

  const offset = (query.page - 1) * query.limit;

  // count(*) OVER () ให้จำนวนรวมมาพร้อมผลลัพธ์ ไม่ต้อง query ซ้ำ
  const rows = await prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    SELECT p.id, count(*) OVER () AS total
    FROM "Product" p
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY ${orderByFragment(query.sort)}
    LIMIT ${query.limit} OFFSET ${offset}
  `);

  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  const ids = rows.map((row) => row.id);

  if (ids.length === 0) {
    return {
      items: [],
      total,
      page: query.page,
      limit: query.limit,
      totalPages: 0,
      appliedSort: query.sort,
    };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: PRODUCT_CARD_SELECT,
  });

  // findMany ไม่รับประกันลำดับตาม in[] จึงเรียงกลับตามลำดับที่ SQL จัดไว้
  const rank = new Map(ids.map((id, index) => [id, index]));
  const items = products
    .map(toProductCard)
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    appliedSort: query.sort,
  };
}

/** ตัวเลือกสำหรับแผงกรองสินค้า — นับเฉพาะที่มีสินค้าขายอยู่จริง */
export interface ShopFiltersDto {
  categories: { name: string; slug: string; productCount: number }[];
  brands: { name: string; slug: string; productCount: number }[];
  sizes: { name: string; code: string }[];
  colors: { name: string; slug: string; hex: string }[];
  priceRange: { min: number; max: number };
}

export async function getShopFilters(): Promise<ShopFiltersDto> {
  const prisma = getPrisma();
  const activeProduct = { deletedAt: null, status: 'ACTIVE' } as const;

  const [categories, brands, sizes, colors, priceRows] = await Promise.all([
    /**
     * นับสินค้าแบบเดียวกับที่ searchProducts กรอง (หมวดตัวเอง + หมวดย่อย)
     * เพื่อให้ตัวเลขในแผงกรองตรงกับจำนวนที่ได้จริงเมื่อกดกรอง
     * ถ้านับแค่หมวดตัวเอง จะขึ้น "เสื้อ 1 ชิ้น" แต่กดแล้วได้ 3 ชิ้น ซึ่งทำให้ผู้ใช้สับสน
     */
    prisma.$queryRaw<Array<{ name: string; slug: string; product_count: bigint }>>(Prisma.sql`
      SELECT c."name", c."slug",
             (SELECT count(*) FROM "Product" p
               WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
                 AND (p."categoryId" = c.id
                      OR p."categoryId" IN (SELECT id FROM "Category" WHERE "parentId" = c.id))
             ) AS product_count
      FROM "Category" c
      WHERE c."deletedAt" IS NULL AND c."isActive"
      ORDER BY c."sortOrder" ASC
    `),
    prisma.brand.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        name: true,
        slug: true,
        _count: { select: { products: { where: activeProduct } } },
      },
    }),
    prisma.size.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, code: true },
    }),
    prisma.color.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, slug: true, hex: true },
    }),
    prisma.$queryRaw<Array<{ min: unknown; max: unknown }>>(Prisma.sql`
      SELECT MIN(COALESCE(p."salePrice", p."price")) AS min,
             MAX(COALESCE(p."salePrice", p."price")) AS max
      FROM "Product" p
      WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
    `),
  ]);

  const range = priceRows[0];

  return {
    categories: categories
      .map((category) => ({
        name: category.name,
        slug: category.slug,
        productCount: Number(category.product_count),
      }))
      .filter((category) => category.productCount > 0),
    brands: brands
      .filter((brand) => brand._count.products > 0)
      .map((brand) => ({
        name: brand.name,
        slug: brand.slug,
        productCount: brand._count.products,
      })),
    sizes,
    colors,
    priceRange: {
      min: Math.floor(Number(String(range?.min ?? 0))),
      max: Math.ceil(Number(String(range?.max ?? 0))),
    },
  };
}

/** รายละเอียดสินค้า 1 ชิ้น — เพิ่ม viewCount ด้วย (ใช้จัดอันดับความนิยม) */
export async function getProductBySlug(slug: string): Promise<ProductDetailDto> {
  const prisma = getPrisma();

  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      description: true,
      shortDescription: true,
      price: true,
      salePrice: true,
      totalStock: true,
      minimumStock: true,
      tags: true,
      publishedAt: true,
      brand: { select: { name: true, slug: true } },
      category: {
        select: {
          name: true,
          slug: true,
          parent: { select: { name: true, slug: true } },
        },
      },
      images: { select: { url: true, alt: true, isMain: true, sortOrder: true } },
      variants: {
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          sku: true,
          price: true,
          salePrice: true,
          color: { select: { name: true, slug: true, hex: true } },
          size: { select: { name: true, code: true, sortOrder: true } },
          inventory: { select: { quantity: true, reservedQuantity: true } },
        },
      },
    },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้าที่ต้องการ');
  }

  // นับการเข้าชม — ใช้ใน "แนะนำสำหรับคุณ" (STEP 5) และ AI Recommendation (STEP 46)
  await prisma.product.update({
    where: { id: product.id },
    data: { viewCount: { increment: 1 } },
  });

  return toProductDetail(product);
}

/** เหตุผลที่ซื้อไม่ได้ — ให้ frontend แปลงเป็นข้อความที่เหมาะกับบริบท */
export type UnavailableReason = 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

export interface AvailabilityResult {
  purchasable: boolean;
  reason?: UnavailableReason;
  /** จำนวนที่ซื้อได้จริงตอนนี้ */
  available: number;
  variant: {
    id: string;
    sku: string;
    productName: string;
    productSlug: string;
    color: string | null;
    size: string | null;
    finalPrice: number;
  };
}

/**
 * ตรวจว่าซื้อ variant นี้จำนวนเท่านี้ได้จริงไหม (STEP 6)
 *
 * ⚠️ นี่คือด่านจริงของกฎ "ห้ามเพิ่มเกิน stock / ห้ามซื้อของที่หมด"
 *    การจำกัดใน UI เป็นเพียงความสะดวก ไม่ใช่การป้องกัน
 *    STEP 9/10 จะเรียกตรรกะเดียวกันนี้อีกครั้งตอนเพิ่มตะกร้าและตอนยืนยันคำสั่งซื้อ
 *    (และตอนตัดสต็อกจริงจะทำใน transaction พร้อม CHECK constraint ระดับฐานข้อมูล)
 */
export async function checkAvailability(
  variantId: string,
  quantity: number,
): Promise<AvailabilityResult> {
  const variant = await getPrisma().productVariant.findFirst({
    where: { id: variantId, deletedAt: null, isActive: true },
    select: {
      id: true,
      sku: true,
      price: true,
      salePrice: true,
      color: { select: { name: true } },
      size: { select: { name: true } },
      inventory: { select: { quantity: true, reservedQuantity: true } },
      product: {
        select: {
          name: true,
          slug: true,
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

  // กฎราคาอยู่ที่ pricing.ts ที่เดียว (ราคาที่คิดเงินต้องตรงกับที่แสดงหน้าสินค้า)
  const { finalPrice } = resolveVariantPrice(variant, variant.product);

  const info = {
    id: variant.id,
    sku: variant.sku,
    productName: variant.product.name,
    productSlug: variant.product.slug,
    color: variant.color?.name ?? null,
    size: variant.size?.name ?? null,
    finalPrice,
  };

  if (available === 0) {
    return { purchasable: false, reason: 'OUT_OF_STOCK', available, variant: info };
  }

  if (quantity > available) {
    return { purchasable: false, reason: 'INSUFFICIENT_STOCK', available, variant: info };
  }

  return { purchasable: true, available, variant: info };
}
