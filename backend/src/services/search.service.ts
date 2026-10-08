import { getPrisma, Prisma } from '@teenstyle/database';

import type { LookCardDto } from '../models/look.model.ts';
import type { ProductCardDto } from '../models/product.model.ts';
import {
  hasUnavailableCondition,
  parseSearchQuery,
  type ParsedSearch,
  type SearchVocabulary,
  type UnderstoodPart,
} from '../models/search.model.ts';
import type { SearchQuery, SuggestQuery } from '../validators/search.validator.ts';

import { searchArticles } from './knowledge-base.service.ts';
import { searchLooks } from './look.service.ts';
import { SELLING_VARIANT, searchProducts, type ShopResult } from './shop.service.ts';

/**
 * ค้นหาทั้งร้านจากช่องเดียว (STEP 45) — สินค้า · ลุค · คำตอบในคลังความรู้
 *
 * ⚠️ ผลทุกชิ้นมาจากฐานข้อมูลจริงผ่าน service เดิม (\`searchProducts\` · \`searchLooks\` · \`searchArticles\`)
 *    ไม่มีเส้นทางคำนวณราคา/สต็อกแยก — การ์ดสินค้ายังสร้างผ่าน \`toProductCards()\` (ของที่ขายได้จริง · กฎ STEP 15)
 * ⚠️ ไม่ใช้ AI ตีความคำค้น — ตัวตีความ (models/search.model.ts) ใช้คำศัพท์ของร้านเท่านั้น
 *    และทุกเงื่อนไขที่ตีความได้ถูกส่งกลับไปให้หน้าเว็บแสดงและยกเลิกได้
 */

/**
 * คำศัพท์ของร้านสำหรับตีความ — อ่านใหม่ทุกคำขอ (สี/ไซซ์/หมวดแก้ได้ · ตารางเล็ก ~1ms)
 *
 * ⚠️ สีนับเฉพาะที่มีตัวเลือกขายอยู่จริง (แก้ตอน STEP 48 — เงื่อนไขเดียวกับแผงกรองของ `/shop`)
 *    ร้านเพิ่มสีใหม่หรือปิดสีได้แล้วที่ /admin/catalog — ถ้านับทุกสี "เสื้อสีที่ยังไม่มีสินค้า"
 *    จะถูกตีความเป็นตัวกรองที่ไม่มีผล แล้วได้หน้าว่างโดยไม่บอกว่าร้านไม่มีสีนี้ (กฎ STEP 45 ข้อ 3)
 */
export async function loadSearchVocabulary(): Promise<SearchVocabulary> {
  const prisma = getPrisma();
  const [colors, sizes, categories, tags] = await Promise.all([
    prisma.color.findMany({
      where: { isActive: true, variants: { some: SELLING_VARIANT } },
      select: { slug: true, name: true },
    }),
    prisma.size.findMany({ select: { code: true, name: true } }),
    prisma.category.findMany({ where: { deletedAt: null }, select: { name: true } }),
    prisma.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT unnest(p."tags") AS tag
        FROM "Product" p
       WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'`,
  ]);

  return {
    colors,
    sizes,
    words: [...categories.map((category) => category.name), ...tags.map((row) => row.tag)],
  };
}

/** เงื่อนไขชุดเดียวกันในรูป query ของ /shop — หน้าเว็บใช้ทำลิงก์ "กรองต่อที่หน้าร้าน" */
function toShopQuery(parsed: ParsedSearch): Record<string, string> {
  const { filters, terms } = parsed;
  const shop: Record<string, string> = {};

  if (terms.length > 0) shop['q'] = terms.join(' ');
  if (filters.colors.length > 0) shop['color'] = filters.colors.join(',');
  if (filters.sizes.length > 0) shop['size'] = filters.sizes.join(',');
  // ตัวกรองราคาของ /shop รับจำนวนเต็ม — ปัดเข้าหาช่วงที่ลูกค้าขอ (ไม่กว้างกว่าที่ขอ)
  if (filters.minPrice !== undefined) shop['minPrice'] = String(Math.ceil(filters.minPrice));
  if (filters.maxPrice !== undefined) shop['maxPrice'] = String(Math.floor(filters.maxPrice));
  if (filters.inStock) shop['inStock'] = 'true';
  if (filters.onSale) shop['onSale'] = 'true';

  return shop;
}

const EMPTY_PRODUCTS = (query: SearchQuery): ShopResult => ({
  items: [],
  total: 0,
  page: query.page,
  limit: query.limit,
  totalPages: 0,
  appliedSort: query.sort,
});

export interface SearchArticleDto {
  slug: string;
  title: string;
  summary: string;
  /** คำถาม-คำตอบที่ตรงกับคำค้นที่สุด — ลูกค้าได้คำตอบในหน้าค้นหาเลยโดยไม่ต้องเปิดบทความ */
  faq: { question: string; answer: string } | null;
}

export interface SearchResultDto {
  query: string;
  literal: boolean;
  terms: string[];
  understood: UnderstoodPart[];
  shopQuery: Record<string, string>;
  products: ShopResult;
  /** ลุคที่ตรงกับคำค้น — เฉพาะหน้าแรกของผล และเมื่อมีคำค้น (สีหรือราคาอย่างเดียวไม่บอกว่าอยากได้ลุคไหน) */
  looks: LookCardDto[];
  articles: SearchArticleDto[];
  /** "คุณหมายถึง…" — เฉพาะเมื่อไม่พบสินค้า · มาจากชื่อสินค้า/tag/หมวดที่มีจริงเท่านั้น */
  suggestions: string[];
}

/**
 * คำที่ใกล้เคียงกับคำค้นที่สุด (pg_trgm `word_similarity`) จากชื่อสินค้า tag และหมวดที่มีจริง
 *
 * ⚠️ ผลขึ้นกับ locale ของฐานข้อมูล — ฐานข้อมูลที่ตัดตัวอักษรไทยออกจากการทำ trigram จะได้คะแนน 0
 *    แล้ว **ไม่แนะนำอะไรเลย** (ไม่ใช่แนะนำผิด) · เครื่องนี้ (ctype Thai_Thailand) ตรวจแล้วว่าใช้ได้
 */
async function didYouMean(terms: readonly string[]): Promise<string[]> {
  if (terms.length === 0) return [];

  const text = terms.join(' ');
  const rows = await getPrisma().$queryRaw<{ candidate: string; score: number }[]>(Prisma.sql`
    SELECT candidate, max(score) AS score FROM (
      SELECT p."name" AS candidate, word_similarity(${text}, p."name") AS score
        FROM "Product" p
       WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
      UNION ALL
      SELECT tag, word_similarity(${text}, tag)
        FROM (SELECT DISTINCT unnest(p."tags") AS tag
                FROM "Product" p
               WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE') tags
      UNION ALL
      SELECT c."name", word_similarity(${text}, c."name")
        FROM "Category" c
       WHERE c."deletedAt" IS NULL
    ) candidates
    WHERE score >= 0.4 AND lower(candidate) <> lower(${text})
    GROUP BY candidate
    ORDER BY max(score) DESC, length(candidate)
    LIMIT 3
  `);

  return rows.map((row) => row.candidate);
}

/** คำถามในบทความที่ตรงกับคำค้นที่สุด — ไม่มีคำไหนตรงก็ไม่แสดง (ไม่หยิบข้อแรกมาให้ดูเหมือนตรง) */
function bestFaq(
  faqs: readonly { question: string; answer: string }[],
  terms: readonly string[],
): { question: string; answer: string } | null {
  const scored = faqs
    .map((faq) => {
      const text = `${faq.question} ${faq.answer}`.toLowerCase();

      return { faq, score: terms.filter((term) => text.includes(term.toLowerCase())).length };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.faq ?? null;
}

export async function searchCatalog(query: SearchQuery): Promise<SearchResultDto> {
  const parsed = parseSearchQuery(query.q, await loadSearchVocabulary(), query.literal);
  const { filters, terms } = parsed;
  // สีที่ร้านไม่มี หรือช่วงราคาที่ขัดกันเอง → ไม่มีสินค้าไหนเข้าได้ · บอกเหตุผลแทนการแสดงของอื่น
  const impossible = hasUnavailableCondition(parsed);
  const firstPage = query.page === 1;

  const [products, looks, articles] = await Promise.all([
    impossible
      ? Promise.resolve(EMPTY_PRODUCTS(query))
      : searchProducts({
          terms,
          color: filters.colors,
          size: filters.sizes,
          ...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {}),
          ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
          inStock: filters.inStock,
          onSale: filters.onSale,
          sort: query.sort,
          page: query.page,
          limit: query.limit,
        }),
    // ลุคไม่มีตัวกรองสี/ไซซ์ — ถ้าเงื่อนไขของลูกค้าเป็นไปไม่ได้ (เช่น สีที่ร้านไม่มี) อย่าโชว์ลุคที่ไม่สนเงื่อนไขนั้น
    firstPage && terms.length > 0 && !impossible
      ? searchLooks({ q: terms.join(' '), sort: 'featured', page: 1, limit: 4 }).then(
          (result) => result.items,
        )
      : Promise.resolve([] as LookCardDto[]),
    firstPage && terms.length > 0
      ? searchArticles({ q: terms.join(' '), page: 1, limit: 3, publishedOnly: true }).then(
          (result) =>
            result.items.map((article) => ({
              slug: article.slug,
              title: article.title,
              summary: article.summary,
              faq: bestFaq(article.faqPairs, terms),
            })),
        )
      : Promise.resolve([] as SearchArticleDto[]),
  ]);

  return {
    query: query.q,
    literal: query.literal,
    terms,
    understood: parsed.understood,
    shopQuery: toShopQuery(parsed),
    products,
    looks,
    articles,
    suggestions: products.total === 0 && !impossible ? await didYouMean(terms) : [],
  };
}

/* ───────────────────────── คำแนะนำระหว่างพิมพ์ ───────────────────────── */

export interface SearchSuggestDto {
  query: string;
  understood: UnderstoodPart[];
  products: Pick<
    ProductCardDto,
    'id' | 'slug' | 'name' | 'image' | 'price' | 'finalPrice' | 'stockStatus'
  >[];
  categories: { slug: string; name: string }[];
}

/**
 * คำแนะนำระหว่างพิมพ์ — ตัวตีความ + ค้นสินค้าชุดเดียวกับหน้าผลค้นหา (แค่ 5 ชิ้นแรก)
 * สิ่งที่ขึ้นในกล่องแนะนำจึงเป็นสิ่งเดียวกับที่ลูกค้าจะเห็นเมื่อกดค้นหา
 */
export async function suggestSearch(query: SuggestQuery): Promise<SearchSuggestDto> {
  const parsed = parseSearchQuery(query.q, await loadSearchVocabulary());
  const { filters, terms } = parsed;
  const prisma = getPrisma();

  const [products, categories] = await Promise.all([
    hasUnavailableCondition(parsed)
      ? Promise.resolve([] as ProductCardDto[])
      : searchProducts({
          terms,
          color: filters.colors,
          size: filters.sizes,
          ...(filters.minPrice !== undefined ? { minPrice: filters.minPrice } : {}),
          ...(filters.maxPrice !== undefined ? { maxPrice: filters.maxPrice } : {}),
          inStock: filters.inStock,
          onSale: filters.onSale,
          sort: 'relevance',
          page: 1,
          limit: 5,
        }).then((result) => result.items),
    terms.length === 0
      ? Promise.resolve([])
      : prisma.category.findMany({
          where: {
            deletedAt: null,
            OR: terms.map((term) => ({ name: { contains: term, mode: 'insensitive' as const } })),
          },
          select: { slug: true, name: true },
          take: 3,
        }),
  ]);

  return {
    query: query.q,
    understood: parsed.understood,
    products: products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      image: product.image,
      price: product.price,
      finalPrice: product.finalPrice,
      stockStatus: product.stockStatus,
    })),
    categories,
  };
}
