import { getPrisma, Prisma } from '@teenstyle/database';

import { toLookDetail, type LookDetailDto } from '../models/look-detail.model.ts';
import { toLookCard, type LookCardDto } from '../models/look.model.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import type { LookQuery } from '../validators/look.validator.ts';

/**
 * Look service (STEP 7) — ไอเดียการแต่งตัวที่จัดไว้แล้ว
 *
 * ทำไมใช้ raw SQL ในการกรอง/เรียง
 *   ราคารวมของลุคเป็น "ผลรวมของราคาที่จ่ายจริงของสินค้าในลุค" — เป็นนิพจน์ที่ Prisma
 *   orderBy/where ทำไม่ได้ (เหมือนกรณี COALESCE(salePrice, price) ใน shop.service.ts)
 *   จึงใช้ SQL หา id ที่เรียง/กรองแล้ว + จำนวนรวม แล้วให้ Prisma ดึงข้อมูลเต็มแบบ type-safe
 *
 * ค่าจากผู้ใช้ส่งผ่าน parameter ของ Prisma.sql ทั้งหมด (กัน SQL injection)
 * ORDER BY มาจาก whitelist ที่ผ่าน Zod enum แล้วเท่านั้น
 *
 * STEP 8 จะเพิ่มหน้ารายละเอียดลุค (`/looks/[slug]`) + ปุ่มซื้อทั้งชุด
 */

const ACTIVE_LOOK = { deletedAt: null, isActive: true } as const;

/** สินค้าที่ยังขายอยู่จริงเท่านั้นที่จะโผล่ในลุค */
const ACTIVE_PRODUCT = { deletedAt: null, status: 'ACTIVE' } as const;

/** field ที่ mapper ของ look ต้องใช้ */
const LOOK_CARD_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  style: true,
  imageUrl: true,
  imageAlt: true,
  isFeatured: true,
  // จำนวนชิ้นที่ลุคจัดไว้ทั้งหมด (รวมชิ้นที่สินค้าถูกปิดขายแล้ว)
  _count: { select: { items: true } },
  items: {
    where: { product: ACTIVE_PRODUCT },
    orderBy: { sortOrder: 'asc' },
    select: {
      note: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          salePrice: true,
          minimumStock: true,
          images: { where: { isMain: true }, select: { url: true, alt: true }, take: 1 },
          // จำนวนที่ซื้อได้จริงต้องคิดจาก Inventory ไม่ใช่ cache `totalStock`
          // (ดูเหตุผลในคอมเมนต์ของ LOOK_STATS ด้านล่าง)
          variants: {
            where: { deletedAt: null, isActive: true },
            select: { inventory: { select: { quantity: true, reservedQuantity: true } } },
          },
        },
      },
      variant: {
        select: {
          sku: true,
          color: { select: { name: true } },
          size: { select: { name: true } },
        },
      },
    },
  },
} as const satisfies Prisma.LookSelect;

export interface LookListResult {
  items: LookCardDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedSort: LookQuery['sort'];
}

/**
 * ตารางชั่วคราวที่คำนวณราคารวม / จำนวนชิ้น / ความพร้อมขาย ของแต่ละลุค
 *
 * - `total_price` และ `active_items` นับเฉพาะสินค้าที่ยังขายอยู่
 * - `all_available` เป็น false ถ้ามีชิ้นใดถูกปิดขายหรือซื้อไม่ได้ (ตรงกับ mapper ฝั่ง TS)
 *
 * ⚠️ ความพร้อมขายคิดจาก Inventory (quantity − reservedQuantity) ไม่ใช่ `Product.totalStock`
 *    เพราะ totalStock เป็น cache ของ "ของในคลัง" ที่ยังไม่หักจำนวนที่ถูกจองไว้
 *    ถ้าใช้ totalStock ลุคที่ของถูกจองไปหมดแล้วจะยังโฆษณาว่า "ซื้อครบชุดได้" ซึ่งไม่จริง
 */
const LOOK_STATS = Prisma.sql`
  SELECT l.id,
         COALESCE(SUM(COALESCE(p."salePrice", p."price")), 0) AS total_price,
         count(p.id) AS active_items,
         count(li.id) AS all_items,
         bool_and(p.id IS NOT NULL AND pa.available > 0) AS all_available
  FROM "Look" l
  LEFT JOIN "LookItem" li ON li."lookId" = l.id
  LEFT JOIN "Product" p
         ON p.id = li."productId" AND p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(inv."quantity" - inv."reservedQuantity", 0)), 0) AS available
    FROM "ProductVariant" v
    JOIN "Inventory" inv ON inv."variantId" = v.id
    WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v."isActive" = true
  ) pa ON true
  WHERE l."deletedAt" IS NULL AND l."isActive" = true
  GROUP BY l.id
`;

function orderByFragment(sort: LookQuery['sort']): Prisma.Sql {
  switch (sort) {
    case 'featured':
      return Prisma.sql`l."isFeatured" DESC, l."viewCount" DESC, l."createdAt" DESC`;
    case 'newest':
      return Prisma.sql`l."createdAt" DESC`;
    case 'popular':
      return Prisma.sql`l."viewCount" DESC, l."createdAt" DESC`;
    case 'price-asc':
      return Prisma.sql`s.total_price ASC, l."createdAt" DESC`;
    case 'price-desc':
      return Prisma.sql`s.total_price DESC, l."createdAt" DESC`;
  }
}

/** ค้นหา/กรองลุคสำหรับหน้า /looks */
export async function searchLooks(query: LookQuery): Promise<LookListResult> {
  const prisma = getPrisma();

  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."deletedAt" IS NULL`,
    Prisma.sql`l."isActive" = true`,
  ];

  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(Prisma.sql`(l."name" ILIKE ${pattern} OR l."description" ILIKE ${pattern})`);
  }

  if (query.style && query.style.length > 0) {
    // cast เป็น text เพื่อเทียบกับค่าที่ส่งมาเป็น parameter ได้โดยไม่ต้องแปลง enum
    conditions.push(Prisma.sql`l."style"::text IN (${Prisma.join(query.style)})`);
  }

  if (query.minPrice !== undefined) {
    conditions.push(Prisma.sql`s.total_price >= ${query.minPrice}`);
  }
  if (query.maxPrice !== undefined) {
    conditions.push(Prisma.sql`s.total_price <= ${query.maxPrice}`);
  }

  if (query.available) {
    conditions.push(Prisma.sql`s.all_available IS TRUE`);
    conditions.push(Prisma.sql`s.active_items = s.all_items`);
    conditions.push(Prisma.sql`s.active_items > 0`);
  }

  const offset = (query.page - 1) * query.limit;

  const rows = await prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    WITH look_stats AS (${LOOK_STATS})
    SELECT l.id, count(*) OVER () AS total
    FROM "Look" l
    JOIN look_stats s ON s.id = l.id
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

  const looks = await prisma.look.findMany({
    where: { id: { in: ids } },
    select: LOOK_CARD_SELECT,
  });

  // findMany ไม่รับประกันลำดับตาม in[] จึงเรียงกลับตามที่ SQL จัดไว้
  const rank = new Map(ids.map((id, index) => [id, index]));
  const items = looks.map(toLookCard).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    appliedSort: query.sort,
  };
}

export interface LookFiltersDto {
  /** สไตล์ที่มีลุคอยู่จริง พร้อมจำนวน (ตรงกับผลค้นหาเมื่อกดกรอง) */
  styles: { value: string; lookCount: number }[];
  /** ช่วงราคารวมของลุคทั้งหมด */
  priceRange: { min: number; max: number };
  /** จำนวนลุคทั้งหมดที่เผยแพร่ */
  total: number;
  /** จำนวนลุคที่ซื้อครบชุดได้ตอนนี้ */
  availableCount: number;
}

export async function getLookFilters(): Promise<LookFiltersDto> {
  const prisma = getPrisma();

  const [styleRows, summaryRows] = await Promise.all([
    prisma.look.groupBy({
      by: ['style'],
      where: ACTIVE_LOOK,
      _count: { _all: true },
    }),
    prisma.$queryRaw<
      Array<{ min: unknown; max: unknown; total: bigint; available: bigint }>
    >(Prisma.sql`
      WITH look_stats AS (${LOOK_STATS})
      SELECT MIN(s.total_price) AS min,
             MAX(s.total_price) AS max,
             count(*) AS total,
             count(*) FILTER (
               WHERE s.all_available IS TRUE AND s.active_items = s.all_items AND s.active_items > 0
             ) AS available
      FROM look_stats s
    `),
  ]);

  const summary = summaryRows[0];

  return {
    styles: styleRows
      .map((row) => ({ value: String(row.style), lookCount: row._count._all }))
      .filter((style) => style.lookCount > 0)
      .sort((a, b) => b.lookCount - a.lookCount || a.value.localeCompare(b.value)),
    priceRange: {
      min: Math.floor(Number(String(summary?.min ?? 0))),
      max: Math.ceil(Number(String(summary?.max ?? 0))),
    },
    total: summary ? Number(summary.total) : 0,
    availableCount: summary ? Number(summary.available) : 0,
  };
}

/**
 * Look แนะนำสำหรับหน้าแรก (STEP 5)
 * เรียงลุคที่ตั้งเป็น featured ไว้ก่อน แล้วตามด้วยความนิยม
 */
export async function listFeaturedLooks(limit: number): Promise<LookCardDto[]> {
  const looks = await getPrisma().look.findMany({
    where: ACTIVE_LOOK,
    orderBy: [{ isFeatured: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: LOOK_CARD_SELECT,
  });

  return looks.map(toLookCard);
}

/* ─── STEP 8: หน้ารายละเอียดลุค + ตรวจสต็อกทั้งชุด ────────────────────────── */

/** field ที่ mapper ของหน้ารายละเอียดลุคต้องใช้ */
const LOOK_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  style: true,
  imageUrl: true,
  imageAlt: true,
  isFeatured: true,
  viewCount: true,
  _count: { select: { items: true } },
  items: {
    where: { product: ACTIVE_PRODUCT },
    orderBy: { sortOrder: 'asc' },
    select: {
      note: true,
      variantId: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          price: true,
          salePrice: true,
          minimumStock: true,
          brand: { select: { name: true, slug: true } },
          category: { select: { name: true, slug: true } },
          images: { where: { isMain: true }, select: { url: true, alt: true }, take: 1 },
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
      },
    },
  },
} as const satisfies Prisma.LookSelect;

/** รายละเอียดลุค 1 ชุด — เพิ่ม viewCount ด้วย (ใช้จัดอันดับความนิยม) */
export async function getLookBySlug(slug: string): Promise<LookDetailDto> {
  const prisma = getPrisma();

  const look = await prisma.look.findFirst({
    where: { slug, ...ACTIVE_LOOK },
    select: LOOK_DETAIL_SELECT,
  });

  if (!look) {
    throw ApiError.notFound('ไม่พบลุคที่ต้องการ');
  }

  await prisma.look.update({
    where: { id: look.id },
    data: { viewCount: { increment: 1 } },
  });

  return toLookDetail(look);
}

export type LookUnavailableReason =
  'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'NOT_IN_LOOK' | 'PRODUCT_UNAVAILABLE';

export interface LookAvailabilityItem {
  variantId: string;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  /** ราคาต่อชิ้นจากฐานข้อมูล (ไม่ใช่ค่าที่ client ส่งมา) */
  finalPrice: number | null;
  lineTotal: number | null;
  available: number;
  purchasable: boolean;
  reason?: LookUnavailableReason;
}

export interface LookAvailabilityResult {
  /** ซื้อทั้งชุดได้ไหม — ต้องเลือกครบทุกชิ้นในลุค และทุกชิ้นต้องซื้อได้ */
  purchasable: boolean;
  /** ราคารวมที่ server คำนวณจากราคาจริง */
  totalPrice: number;
  items: LookAvailabilityItem[];
  /** สินค้าในลุคที่ยังไม่ได้เลือกตัวเลือก (ต้องเลือกให้ครบก่อนซื้อทั้งชุด) */
  missingProducts: { productId: string; name: string; slug: string }[];
  unavailableCount: number;
}

/**
 * ตรวจว่าซื้อ "ทั้งชุด" ได้จริงไหม (STEP 8)
 *
 * ⚠️ นี่คือด่านจริงของกฎ "ห้าม Trust Client-side Price / Stock" สำหรับการซื้อทั้งชุด:
 *   1. ราคาทุกชิ้นอ่านจากฐานข้อมูล — ที่ client ส่งมามีแค่ variantId + จำนวน
 *   2. ตรวจว่า variant ที่ส่งมา **อยู่ในลุคนี้จริง** (กันการยัด variant อื่นเข้ามา)
 *   3. ตรวจสต็อกจาก Inventory (quantity − reserved) ไม่ใช่ cache `Product.totalStock`
 *   4. ต้องเลือกครบทุกชิ้นที่ลุคจัดไว้ ไม่งั้นยังไม่ถือว่าซื้อทั้งชุดได้
 *
 * STEP 9 (ตะกร้า) จะเรียกตรรกะเดียวกันนี้อีกครั้งก่อนบันทึกลงตะกร้า
 * และตอนตัดสต็อกจริงจะทำใน transaction พร้อม CHECK constraint ระดับฐานข้อมูล
 */
export async function checkLookAvailability(
  slug: string,
  selections: { variantId: string; quantity: number }[],
): Promise<LookAvailabilityResult> {
  const prisma = getPrisma();

  const look = await prisma.look.findFirst({
    where: { slug, ...ACTIVE_LOOK },
    select: {
      id: true,
      items: {
        where: { product: ACTIVE_PRODUCT },
        select: { product: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  if (!look) {
    throw ApiError.notFound('ไม่พบลุคที่ต้องการ');
  }

  const lookProductIds = new Set(look.items.map((item) => item.product.id));

  // ดึง variant ทั้งหมดในคำขอครั้งเดียว (ไม่ยิงทีละชิ้น)
  const variantIds = [...new Set(selections.map((selection) => selection.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null, isActive: true },
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
          id: true,
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

  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const selectedProductIds = new Set<string>();

  const items: LookAvailabilityItem[] = selections.map((selection) => {
    const variant = variantById.get(selection.variantId);

    if (!variant || variant.product.deletedAt !== null || variant.product.status !== 'ACTIVE') {
      return {
        variantId: selection.variantId,
        productId: null,
        productName: null,
        productSlug: null,
        sku: null,
        color: null,
        size: null,
        quantity: selection.quantity,
        finalPrice: null,
        lineTotal: null,
        available: 0,
        purchasable: false,
        reason: 'PRODUCT_UNAVAILABLE',
      };
    }

    const base = {
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      sku: variant.sku,
      color: variant.color?.name ?? null,
      size: variant.size?.name ?? null,
      quantity: selection.quantity,
    };

    // variant ต้องเป็นของสินค้าที่อยู่ในลุคนี้จริง
    if (!lookProductIds.has(variant.product.id)) {
      return {
        ...base,
        finalPrice: null,
        lineTotal: null,
        available: 0,
        purchasable: false,
        reason: 'NOT_IN_LOOK',
      };
    }

    selectedProductIds.add(variant.product.id);

    // กฎราคาอยู่ที่ pricing.ts ที่เดียว
    const { finalPrice } = resolveVariantPrice(variant, variant.product);

    const available = Math.max(
      0,
      (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
    );

    if (available === 0) {
      return {
        ...base,
        finalPrice,
        lineTotal: null,
        available,
        purchasable: false,
        reason: 'OUT_OF_STOCK',
      };
    }

    if (selection.quantity > available) {
      return {
        ...base,
        finalPrice,
        lineTotal: null,
        available,
        purchasable: false,
        reason: 'INSUFFICIENT_STOCK',
      };
    }

    return {
      ...base,
      finalPrice,
      lineTotal: finalPrice * selection.quantity,
      available,
      purchasable: true,
    };
  });

  const missingProducts = look.items
    .filter((item) => !selectedProductIds.has(item.product.id))
    .map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
    }));

  const unavailableCount = items.filter((item) => !item.purchasable).length;

  return {
    purchasable: unavailableCount === 0 && missingProducts.length === 0 && items.length > 0,
    // รวมเฉพาะรายการที่ซื้อได้ เพื่อไม่ให้แสดงยอดที่เก็บเงินจริงไม่ได้
    totalPrice: items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0),
    items,
    missingProducts,
    unavailableCount,
  };
}
