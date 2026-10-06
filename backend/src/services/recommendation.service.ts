import { getPrisma, Prisma } from '@teenstyle/database';

import { HAS_AVAILABLE_STOCK_SQL } from '../models/availability.ts';
import { resolveProductPrice } from '../models/pricing.ts';
import type { ProductCardDto } from '../models/product.model.ts';
import {
  scoreCandidates,
  scoreSimilar,
  type CoPurchase,
  type RecommendableProduct,
  type Signal,
  type SignalSource,
} from '../models/recommendation.model.ts';
import { ApiError } from '../utils/api-error.ts';

import { PRODUCT_CARD_SELECT, toProductCards } from './product.service.ts';
import { SALES_JOIN, SAVES_JOIN } from './shop.service.ts';

/**
 * การแนะนำสินค้า (STEP 46) — กฎการให้คะแนนอยู่ที่ models/recommendation.model.ts
 *
 * ⚠️ **สวิตช์ "ให้ระบบแนะนำจากพฤติกรรมของฉัน" (`User.allowPersonalization`) ต้องมีผลจริง** —
 *    ปิดแล้วต้องไม่อ่านประวัติของคนนั้นเลย และได้รายการเดียวกับคนที่ไม่ได้ล็อกอิน
 *    (ก่อน STEP นี้หน้าโปรไฟล์บอกลูกค้าว่าสวิตช์นี้มีผล ทั้งที่ไม่มีโค้ดไหนอ่านค่านี้)
 * ⚠️ แนะนำเฉพาะของที่ **ขายได้จริง** (`HAS_AVAILABLE_STOCK_SQL` + ตรวจซ้ำตอนสร้างการ์ด) — กฎ STEP 15
 * ⚠️ ไม่เก็บ "โปรไฟล์ความชอบ" ลงฐานข้อมูล — คำนวณสดจากสิ่งที่มีอยู่แล้วทุกครั้ง
 *    จึงไม่มีข้อมูลส่วนบุคคลชุดใหม่ที่ต้องดูแลตาม PDPA (STEP 53) และไม่มีค่าที่ค้างเก่า
 */

/** ผู้สมัครที่ให้คะแนนต่อคำขอ — กรองด้วย SQL ก่อน (หมวด/แบรนด์/tag/ซื้อด้วยกัน) ไม่ดึงทั้งแคตตาล็อก */
const CANDIDATE_LIMIT = 400;

const PRODUCT_SIGNAL_SELECT = {
  id: true,
  name: true,
  categoryId: true,
  category: { select: { parentId: true } },
  brandId: true,
  tags: true,
  price: true,
  salePrice: true,
} satisfies Prisma.ProductSelect;

type ProductSignalRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SIGNAL_SELECT }>;

function toRecommendable(row: ProductSignalRow): RecommendableProduct {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    parentCategoryId: row.category.parentId,
    brandId: row.brandId,
    tags: row.tags,
    finalPrice: resolveProductPrice(row).finalPrice,
  };
}

const ACTIVE = Prisma.sql`p."deletedAt" IS NULL AND p."status" = 'ACTIVE'`;

/** รีวิวที่ให้ไม่เกินเท่านี้ = ไม่ชอบสินค้านั้น */
const DISLIKE_MAX_RATING = 2;

/**
 * สิ่งที่ลูกค้าคนนี้ทำจริงในร้าน — คำสั่งซื้อที่ไม่ได้ยกเลิก/คืนเงิน · ที่ถูกใจ · ตะกร้า · รีวิว 4 ดาวขึ้นไป
 *
 * ⚠️ **สินค้าที่ลูกค้ารีวิว 1–2 ดาว = ไม่ชอบ** → ไม่เป็นสัญญาณจากทางไหนเลย (แม้จะซื้อไปแล้ว)
 *    และไม่ถูกแนะนำกลับ · ไม่งั้นได้เหตุผลว่า "คล้าย “X” ที่คุณสั่งซื้อ" ทั้งที่ลูกค้าบอกร้านว่า X แย่
 *    (รีวิวได้ต้องได้รับของแล้ว จึงเป็นของที่ลูกค้าซื้อจริงเกือบทุกครั้ง)
 *
 * `hadHistory` = มีประวัติอยู่ก่อนตัดสิ่งที่ไม่ชอบออก — ใช้เลือกเหตุผลที่บอกลูกค้าให้ถูก
 */
async function loadSignals(
  userId: string,
): Promise<{ signals: Signal[]; disliked: Set<string>; hadHistory: boolean }> {
  const prisma = getPrisma();
  const product = { select: PRODUCT_SIGNAL_SELECT };

  const [ordered, wished, carted, reviewed, dislikedRows] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        productId: { not: null },
        order: { userId, deletedAt: null, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      },
      select: { product },
    }),
    prisma.wishlist.findMany({ where: { userId }, select: { product } }),
    prisma.cartItem.findMany({
      where: { cart: { userId } },
      select: { variant: { select: { product } } },
    }),
    prisma.review.findMany({
      where: { userId, rating: { gte: 4 }, deletedAt: null },
      select: { product },
    }),
    prisma.review.findMany({
      where: { userId, rating: { lte: DISLIKE_MAX_RATING }, deletedAt: null },
      select: { productId: true },
    }),
  ]);

  const disliked = new Set(dislikedRows.map((row) => row.productId));
  const signal = (source: SignalSource, row: ProductSignalRow | null): Signal[] =>
    row === null ? [] : [{ source, product: toRecommendable(row) }];

  const all = [
    ...ordered.flatMap((row) => signal('PURCHASE', row.product)),
    ...reviewed.flatMap((row) => signal('REVIEW', row.product)),
    ...wished.flatMap((row) => signal('WISHLIST', row.product)),
    ...carted.flatMap((row) => signal('CART', row.variant.product)),
  ];

  return {
    signals: all.filter((item) => !disliked.has(item.product.id)),
    disliked,
    // รีวิวว่าไม่ชอบก็คือประวัติ (ซื้อแล้วคืนเงิน + รีวิว 1 ดาว = มีประวัติ แต่ไม่มีสัญญาณที่ใช้ได้)
    hadHistory: all.length > 0 || disliked.size > 0,
  };
}

/**
 * สินค้าที่ลูกค้า **คนอื่น** ซื้อในคำสั่งซื้อเดียวกันกับสินค้าเหล่านี้ (เฉพาะใบที่ร้านได้เงินแล้ว)
 * คืนคู่ที่แข็งที่สุดต่อสินค้า (anchor ที่ซื้อด้วยกันบ่อยสุด)
 */
async function coPurchases(
  anchorIds: readonly string[],
  excludeUserId: string | null,
): Promise<CoPurchase[]> {
  if (anchorIds.length === 0) return [];

  const rows = await getPrisma().$queryRaw<
    { product_id: string; anchor_name: string; orders: bigint }[]
  >(Prisma.sql`
    SELECT oi2."productId" AS product_id, anchor."name" AS anchor_name,
           count(DISTINCT oi2."orderId") AS orders
      FROM "OrderItem" oi1
      JOIN "OrderItem" oi2 ON oi2."orderId" = oi1."orderId" AND oi2."productId" <> oi1."productId"
      JOIN "Order" o ON o.id = oi1."orderId"
      JOIN "Product" anchor ON anchor.id = oi1."productId"
     WHERE oi1."productId" IN (${Prisma.join(anchorIds.map((id) => Prisma.sql`${id}::uuid`))})
       AND oi2."productId" IS NOT NULL
       AND o."deletedAt" IS NULL AND o."paymentStatus" = 'PAID'
       AND o."status" NOT IN ('CANCELLED', 'REFUNDED')
       ${excludeUserId === null ? Prisma.empty : Prisma.sql`AND o."userId" <> ${excludeUserId}::uuid`}
     GROUP BY oi2."productId", anchor."name"
  `);

  const best = new Map<string, CoPurchase>();

  for (const row of rows) {
    const orders = Number(row.orders);
    const current = best.get(row.product_id);

    if (current === undefined || orders > current.orders) {
      best.set(row.product_id, { productId: row.product_id, orders, anchorName: row.anchor_name });
    }
  }

  return [...best.values()];
}

/** ผู้สมัครที่ขายได้จริงและเกี่ยวกับความชอบ (หมวด/หมวดแม่/แบรนด์/tag) หรือถูกซื้อด้วยกัน */
async function loadCandidates(filter: {
  categoryIds: readonly string[];
  parentIds: readonly string[];
  brandIds: readonly string[];
  tags: readonly string[];
  productIds: readonly string[];
}): Promise<RecommendableProduct[]> {
  const uuids = (ids: readonly string[]) =>
    ids.length === 0
      ? Prisma.sql`NULL::uuid`
      : Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));

  const rows = await getPrisma().$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "Product" p
     WHERE ${ACTIVE} AND ${HAS_AVAILABLE_STOCK_SQL}
       AND (
         p."categoryId" IN (${uuids(filter.categoryIds)})
         OR p."categoryId" IN (SELECT c.id FROM "Category" c WHERE c."parentId" IN (${uuids(filter.parentIds)}) OR c.id IN (${uuids(filter.parentIds)}))
         OR p."brandId" IN (${uuids(filter.brandIds)})
         OR p."tags" && ${[...filter.tags]}::text[]
         OR p.id IN (${uuids(filter.productIds)})
       )
     LIMIT ${CANDIDATE_LIMIT}
  `);

  if (rows.length === 0) return [];

  const products = await getPrisma().product.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: PRODUCT_SIGNAL_SELECT,
  });

  return products.map(toRecommendable);
}

/** การ์ดสินค้าตามลำดับที่ส่งมา — สร้างผ่าน `toProductCards` (ขายได้จริง · กฎ STEP 15) แล้วตัดของหมดทิ้ง */
async function cardsInOrder(ids: readonly string[]): Promise<Map<string, ProductCardDto>> {
  if (ids.length === 0) return new Map();

  const rows = await getPrisma().product.findMany({
    where: { id: { in: [...ids] }, deletedAt: null, status: 'ACTIVE' },
    select: PRODUCT_CARD_SELECT,
  });
  const cards = await toProductCards(rows);

  return new Map(
    cards.filter((card) => card.stockStatus !== 'OUT_OF_STOCK').map((card) => [card.id, card]),
  );
}

/**
 * สินค้ายอดนิยมที่ขายได้จริง — คนกดถูกใจ → ขายได้ (ใบที่ได้เงินแล้ว) → การเข้าชม
 * ใช้กับคนที่ไม่มีประวัติ / ไม่ได้ล็อกอิน / ปิดการแนะนำ และเติมรายการที่ยังไม่ครบ
 */
async function popularIds(limit: number, exclude: ReadonlySet<string>): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "Product" p
    ${SAVES_JOIN}
    ${SALES_JOIN}
     WHERE ${ACTIVE} AND ${HAS_AVAILABLE_STOCK_SQL}
     ORDER BY COALESCE(saves.saves, 0) DESC, COALESCE(sales.sold, 0) DESC,
              p."viewCount" DESC, p."publishedAt" DESC NULLS LAST, p.id
     LIMIT ${limit + exclude.size}
  `);

  return rows
    .map((row) => row.id)
    .filter((id) => !exclude.has(id))
    .slice(0, limit);
}

/* ═══════════════════════ แนะนำสำหรับคุณ ═══════════════════════ */

export interface RecommendedItemDto {
  product: ProductCardDto;
  /** เหตุผลที่อ้างสิ่งที่ลูกค้าทำจริง — "ยอดนิยมในร้าน" เมื่อเป็นรายการเติม */
  reason: string;
}

/**
 * - `PERSONAL` = มีอย่างน้อยหนึ่งชิ้นที่มาจากสิ่งที่คนนี้ทำจริง
 * - `POPULAR` = ไม่ได้ใช้ประวัติของใคร — หน้าเว็บต้องเรียกว่า "ยอดนิยม" ไม่ใช่ "สำหรับคุณ"
 */
export interface ForYouDto {
  mode: 'PERSONAL' | 'POPULAR';
  /** ทำไมถึงไม่ใช่รายการเฉพาะบุคคล — หน้าเว็บบอกลูกค้าตามนี้ */
  fallbackReason: 'GUEST' | 'OPTED_OUT' | 'NO_HISTORY' | 'NO_MATCH' | null;
  items: RecommendedItemDto[];
}

const POPULAR_REASON = 'ยอดนิยมในร้าน';

/**
 * `exclude` = ของที่ลูกค้าบอกว่าไม่ชอบ — ส่งมาได้เฉพาะเมื่ออ่านประวัติได้แล้ว
 * (คนที่ปิดการแนะนำ/ไม่ล็อกอินต้องได้ชุดเดียวกับทุกคน จึงว่างเสมอ)
 */
async function popularFor(
  limit: number,
  fallbackReason: NonNullable<ForYouDto['fallbackReason']>,
  exclude: ReadonlySet<string> = new Set(),
): Promise<ForYouDto> {
  const ids = await popularIds(limit, exclude);
  const cards = await cardsInOrder(ids);

  return {
    mode: 'POPULAR',
    fallbackReason,
    items: ids.flatMap((id) => {
      const product = cards.get(id);
      return product === undefined ? [] : [{ product, reason: POPULAR_REASON }];
    }),
  };
}

export async function recommendForUser(userId: string | null, limit: number): Promise<ForYouDto> {
  if (userId === null) return popularFor(limit, 'GUEST');

  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: { allowPersonalization: true },
  });

  // ปิดการแนะนำจากพฤติกรรม → ไม่อ่านประวัติเลย (ไม่ใช่อ่านแล้วไม่โชว์)
  if (user === null || !user.allowPersonalization) return popularFor(limit, 'OPTED_OUT');

  const { signals, disliked, hadHistory } = await loadSignals(userId);

  // มีประวัติแต่ทั้งหมดเป็นของที่ไม่ชอบ → ไม่ใช่ "ยังไม่มีประวัติ" (ข้อความนั้นไม่จริงสำหรับคนนี้)
  if (signals.length === 0) {
    return popularFor(limit, hadHistory ? 'NO_MATCH' : 'NO_HISTORY', disliked);
  }

  const known = new Set(signals.map((signal) => signal.product.id));
  const together = await coPurchases([...known], userId);
  const candidates = await loadCandidates({
    categoryIds: [...new Set(signals.map((s) => s.product.categoryId))],
    parentIds: [...new Set(signals.map((s) => s.product.parentCategoryId ?? s.product.categoryId))],
    brandIds: [
      ...new Set(signals.flatMap((s) => (s.product.brandId === null ? [] : [s.product.brandId]))),
    ],
    tags: [...new Set(signals.flatMap((s) => s.product.tags))],
    productIds: together.map((row) => row.productId),
  });

  const scored = scoreCandidates(candidates, signals, together, disliked).slice(0, limit * 2);
  const cards = await cardsInOrder(scored.map((row) => row.productId));
  const personal = scored
    .flatMap((row) => {
      const product = cards.get(row.productId);
      return product === undefined ? [] : [{ product, reason: row.reason.text }];
    })
    .slice(0, limit);

  if (personal.length === 0) return popularFor(limit, 'NO_MATCH', disliked);

  // ไม่ครบจำนวน → เติมด้วยยอดนิยม **พร้อมบอกว่าเป็นยอดนิยม** (ไม่แต่งเหตุผลส่วนตัวให้)
  const chosen = new Set([...known, ...disliked, ...personal.map((item) => item.product.id)]);
  const fillIds = personal.length < limit ? await popularIds(limit - personal.length, chosen) : [];
  const fillCards = await cardsInOrder(fillIds);

  return {
    mode: 'PERSONAL',
    fallbackReason: null,
    items: [
      ...personal,
      ...fillIds.flatMap((id) => {
        const product = fillCards.get(id);
        return product === undefined ? [] : [{ product, reason: POPULAR_REASON }];
      }),
    ],
  };
}

/* ═══════════════════════ หน้าสินค้า ═══════════════════════ */

export interface ProductRecommendationsDto {
  /** ลูกค้าคนอื่นซื้อพร้อมกันจริงในใบที่ร้านได้เงินแล้ว — ยังไม่มีคำสั่งซื้อ = ว่าง (ไม่เดา) */
  boughtTogether: RecommendedItemDto[];
  /** ลุคที่จัดชิ้นนี้ไว้ พร้อมชิ้นอื่นในลุคที่ยังขายได้ */
  looks: { slug: string; name: string; items: ProductCardDto[] }[];
  similar: RecommendedItemDto[];
}

export async function recommendForProduct(
  slug: string,
  limit = 4,
): Promise<ProductRecommendationsDto> {
  const prisma = getPrisma();
  const base = await prisma.product.findFirst({
    where: { slug, deletedAt: null, status: 'ACTIVE' },
    select: PRODUCT_SIGNAL_SELECT,
  });

  if (base === null) throw ApiError.notFound('ไม่พบสินค้าที่ต้องการ');

  const product = toRecommendable(base);

  const [together, looks, candidates] = await Promise.all([
    coPurchases([product.id], null),
    prisma.look.findMany({
      where: { isActive: true, deletedAt: null, items: { some: { productId: product.id } } },
      select: {
        slug: true,
        name: true,
        items: { orderBy: { sortOrder: 'asc' }, select: { productId: true } },
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: 2,
    }),
    loadCandidates({
      categoryIds: [product.categoryId],
      parentIds: [product.parentCategoryId ?? product.categoryId],
      brandIds: [],
      tags: product.tags,
      productIds: [],
    }),
  ]);

  const boughtIds = together
    .sort((a, b) => b.orders - a.orders || a.productId.localeCompare(b.productId))
    .slice(0, limit * 2);
  const similar = scoreSimilar(product, candidates).slice(0, limit * 2);
  const lookIds = looks.flatMap((look) =>
    look.items.map((item) => item.productId).filter((id) => id !== product.id),
  );

  const cards = await cardsInOrder([
    ...boughtIds.map((row) => row.productId),
    ...similar.map((row) => row.productId),
    ...lookIds,
  ]);

  return {
    boughtTogether: boughtIds
      .flatMap((row) => {
        const card = cards.get(row.productId);
        return card === undefined
          ? []
          : [
              {
                product: card,
                reason: `ซื้อพร้อมกันใน ${row.orders.toLocaleString('th-TH')} คำสั่งซื้อ`,
              },
            ];
      })
      .slice(0, limit),
    looks: looks
      .map((look) => ({
        slug: look.slug,
        name: look.name,
        items: look.items
          .filter((item) => item.productId !== product.id)
          .flatMap((item) => {
            const card = cards.get(item.productId);
            return card === undefined ? [] : [card];
          }),
      }))
      .filter((look) => look.items.length > 0),
    similar: similar
      .flatMap((row) => {
        const card = cards.get(row.productId);
        return card === undefined ? [] : [{ product: card, reason: row.text }];
      })
      .slice(0, limit),
  };
}
