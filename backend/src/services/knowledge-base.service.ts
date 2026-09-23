import { getPrisma, type Prisma } from '@teenstyle/database';
import OpenAI from 'openai';

import { env } from '../config/env.ts';
import { ApiError } from '../utils/api-error.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';
import { logger } from '../utils/logger.ts';
import {
  INITIAL_KNOWLEDGE_ARTICLES,
  KNOWLEDGE_CATEGORIES,
  type KnowledgeArticle,
  type KnowledgeCategory,
  type KnowledgeCategoryMeta,
} from '../models/knowledge-base.model.ts';
import type {
  CreateKnowledgeArticleInput,
  KnowledgeSearchQuery,
  UpdateKnowledgeArticleInput,
} from '../validators/knowledge-base.validator.ts';

/**
 * คลังความรู้ที่ AI ใช้ตอบลูกค้า (STEP 21) — เก็บใน PostgreSQL
 *
 * ⚠️ เดิมเก็บเป็นไฟล์ JSON ใน `backend/src/data/` ซึ่งพังหลายทาง:
 *    แค่เปิดอ่านบทความ (`viewCount + 1`) ก็ทำให้ working tree สกปรก · `npm test` เขียนทับไฟล์จริง ·
 *    ไฟล์ที่ commit ไว้ค้างค่าเก่าแล้วบังหน้าข้อมูลตั้งต้นที่แก้ใหม่ ·
 *    และบน container ที่ filesystem หายตอน redeploy บทความที่แอดมินแก้จะหายทั้งหมด
 *    ตอนนี้ย้ายมาอยู่ในฐานข้อมูลจริงตามกฎกลางข้อ 1 แล้ว
 *
 *    ผลพลอยได้: ตัวนับ view/vote เพิ่มแบบ atomic (`increment`) จึงไม่ตกหล่นเมื่อมีคนใช้พร้อมกัน
 *    และ `AdminLog` เขียนในทรานแซกชันเดียวกับการแก้ข้อมูลได้จริง
 */

/** ข้อมูลตั้งต้นถูกใส่ลงฐานข้อมูลครั้งเดียวต่อ process — กัน COUNT ซ้ำทุกคำขอ */
let seedChecked = false;

const articleInclude = {
  faqPairs: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.KnowledgeArticleInclude;

type ArticleRow = Prisma.KnowledgeArticleGetPayload<{ include: typeof articleInclude }>;

function toArticleDto(row: ArticleRow): KnowledgeArticle {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    content: row.content,
    tags: row.tags,
    faqPairs: row.faqPairs.map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
    })),
    isPublished: row.isPublished,
    viewCount: row.viewCount,
    helpfulCount: row.helpfulCount,
    notHelpfulCount: row.notHelpfulCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * ใส่บทความตั้งต้นลงฐานข้อมูลถ้ายังไม่มีเลย
 *
 * ใช้ `id` คงที่จาก `INITIAL_KNOWLEDGE_ARTICLES` + `skipDuplicates` จึงปลอดภัย
 * แม้หลายคำขอเข้ามาพร้อมกันตอน boot ครั้งแรก
 */
async function ensureSeeded(): Promise<void> {
  if (seedChecked) return;

  const prisma = getPrisma();

  try {
    const existing = await prisma.knowledgeArticle.count();
    if (existing === 0) {
      await prisma.$transaction(
        INITIAL_KNOWLEDGE_ARTICLES.map((article) =>
          prisma.knowledgeArticle.create({
            data: {
              id: article.id,
              slug: article.slug,
              title: article.title,
              category: article.category,
              summary: article.summary,
              content: article.content,
              tags: article.tags,
              isPublished: article.isPublished,
              faqPairs: {
                create: article.faqPairs.map((faq, index) => ({
                  question: faq.question,
                  answer: faq.answer,
                  sortOrder: index,
                })),
              },
            },
          }),
        ),
      );
      logger.info(
        { count: INITIAL_KNOWLEDGE_ARTICLES.length },
        'ใส่บทความตั้งต้นของคลังความรู้ลงฐานข้อมูลแล้ว',
      );
    }

    seedChecked = true;
  } catch (err) {
    // ชนกันตอน seed พร้อมกันหลาย process → อีกฝั่งใส่ไปแล้ว ถือว่าเรียบร้อย
    logger.warn({ err }, 'seed คลังความรู้ไม่สำเร็จ (อาจมี process อื่นใส่ไปแล้ว)');
    seedChecked = true;
  }
}

export interface SearchArticlesResult {
  items: KnowledgeArticle[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * ค้นหาและกรองบทความความรู้
 *
 * การให้คะแนนความเกี่ยวข้องทำใน TypeScript เพราะต้องรองรับทั้งไทยและอังกฤษ
 * และคลังความรู้มีขนาดหลักสิบบทความ — ถ้าโตถึงหลักพันค่อยย้ายไปใช้ full-text search ของ Postgres
 * (`to_tsvector` + ดัชนี GIN) การกรองหมวด/แท็ก/สถานะเผยแพร่ทำที่ฐานข้อมูลแล้ว
 */
export async function searchArticles(
  params: Partial<KnowledgeSearchQuery> & { publishedOnly?: boolean },
): Promise<SearchArticlesResult> {
  await ensureSeeded();

  const prisma = getPrisma();
  const publishedOnly = params.publishedOnly ?? true;

  const where: Prisma.KnowledgeArticleWhereInput = {
    ...(publishedOnly ? { isPublished: true } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.tag ? { tags: { hasSome: [params.tag] } } : {}),
  };

  const rows = await prisma.knowledgeArticle.findMany({
    where,
    include: articleInclude,
    orderBy: { updatedAt: 'desc' },
  });

  let filtered = rows.map(toArticleDto);

  // แท็กเทียบแบบไม่สนตัวพิมพ์และยอมให้ตรงบางส่วน (Prisma `hasSome` เทียบตรงตัวเท่านั้น)
  if (params.tag) {
    const targetTag = params.tag.toLowerCase();
    const loose = rows
      .map(toArticleDto)
      .filter((a) =>
        a.tags.some((t) => t.toLowerCase() === targetTag || t.toLowerCase().includes(targetTag)),
      );
    filtered = loose.length > 0 ? loose : filtered;
  }

  if (params.q) {
    const qLower = params.q.toLowerCase();
    const rawTokens = qLower.split(/\s+/).filter(Boolean);

    const scored = filtered.map((article) => {
      let score = 0;
      const titleLower = article.title.toLowerCase();
      const summaryLower = article.summary.toLowerCase();
      const contentLower = article.content.toLowerCase();

      // 1. Direct substring matching: Does query contain tag or vice versa?
      for (const tag of article.tags) {
        const tagLower = tag.toLowerCase();
        if (qLower.includes(tagLower) || tagLower.includes(qLower)) {
          score += 25;
        }
      }

      // 2. Category match
      if (qLower.includes(article.category.toLowerCase())) {
        score += 15;
      }

      // 3. Title partial/full match
      if (titleLower.includes(qLower) || qLower.includes(titleLower)) {
        score += 35;
      }

      // 4. Token-based matching
      for (const token of rawTokens) {
        if (titleLower.includes(token)) score += 15;
        if (
          article.tags.some(
            (t) => t.toLowerCase().includes(token) || token.includes(t.toLowerCase()),
          )
        ) {
          score += 15;
        }
        if (summaryLower.includes(token)) score += 8;
        if (contentLower.includes(token)) score += 4;
        if (
          article.faqPairs.some(
            (faq) =>
              faq.question.toLowerCase().includes(token) ||
              token.includes(faq.question.toLowerCase()) ||
              qLower.includes(faq.question.toLowerCase()) ||
              faq.answer.toLowerCase().includes(token),
          )
        ) {
          score += 15;
        }
      }

      return { article, score };
    });

    filtered = scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.article);
  }

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(50, Math.max(1, params.limit || 12));
  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);

  return { items, total, page, limit, totalPages };
}

/**
 * ดึงบทความตาม Slug พร้อมนับ View count
 *
 * นับด้วย `increment` ที่ฐานข้อมูล จึงไม่ตกหล่นเมื่อมีคนเปิดอ่านพร้อมกัน
 */
export async function getArticleBySlug(slug: string): Promise<KnowledgeArticle> {
  await ensureSeeded();

  const prisma = getPrisma();
  const existing = await prisma.knowledgeArticle.findFirst({
    where: { slug, isPublished: true },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound(`ไม่พบบทความความรู้สำหรับ "${slug}"`);
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id: existing.id },
    data: { viewCount: { increment: 1 } },
    include: articleInclude,
  });

  return toArticleDto(updated);
}

/**
 * สรุปหมวดหมู่บทความความรู้พร้อมจำนวนบทความในแต่ละหมวด
 */
export async function getCategoriesSummary(): Promise<
  Array<KnowledgeCategoryMeta & { articleCount: number }>
> {
  await ensureSeeded();

  const prisma = getPrisma();
  const grouped = await prisma.knowledgeArticle.groupBy({
    by: ['category'],
    where: { isPublished: true },
    _count: { _all: true },
  });

  const counts = new Map(grouped.map((row) => [row.category, row._count._all]));

  return KNOWLEDGE_CATEGORIES.map((cat) => ({
    ...cat,
    articleCount: counts.get(cat.key) ?? 0,
  }));
}

/**
 * โหวตว่าบทความมีประโยชน์หรือไม่
 */
export async function voteArticleHelpful(
  articleId: string,
  helpful: boolean,
): Promise<{ helpfulCount: number; notHelpfulCount: number }> {
  await ensureSeeded();

  const prisma = getPrisma();
  const existing = await prisma.knowledgeArticle.findUnique({
    where: { id: articleId },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการโหวต');
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id: articleId },
    data: helpful ? { helpfulCount: { increment: 1 } } : { notHelpfulCount: { increment: 1 } },
    select: { helpfulCount: true, notHelpfulCount: true },
  });

  return updated;
}

export interface KnowledgeAskResponse {
  answer: string;
  sourceArticles: Array<{
    id: string;
    slug: string;
    title: string;
    category: KnowledgeCategory;
    summary: string;
  }>;
  suggestedQuestions: string[];
  model: string;
}

/**
 * ตอบคำถามลูกค้าด้วยข้อมูลจริงจากฐานความรู้ (Grounded RAG / No Hallucination)
 */
export async function askKnowledgeBase(
  query: string,
  category?: KnowledgeCategory,
): Promise<KnowledgeAskResponse> {
  const searchRes = await searchArticles({ q: query, category, limit: 3, publishedOnly: true });
  const relevantArticles = searchRes.items;

  // ดึงคำถาม FAQ ที่ตรงกับเนื้อหา
  const matchedFaqs = relevantArticles.flatMap((a) => a.faqPairs);

  const sources = relevantArticles.map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    category: a.category,
    summary: a.summary,
  }));

  // แนะนำคำถามต่อยอด
  const suggestedQuestions: string[] = [];
  for (const faq of matchedFaqs.slice(0, 3)) {
    if (faq.question.toLowerCase() !== query.toLowerCase()) {
      suggestedQuestions.push(faq.question);
    }
  }

  if (suggestedQuestions.length === 0) {
    suggestedQuestions.push(
      'ยอดสั่งซื้อเท่าไรถึงจะได้จัดส่งฟรี?',
      'สามารถขอเปลี่ยนไซซ์ได้ภายในกี่วัน?',
      'มีบริการเก็บเงินปลายทางหรือไม่?',
    );
  }

  // กรณีมี OpenAI API key
  if (env.OPENAI_API_KEY && relevantArticles.length > 0) {
    try {
      const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const contextText = relevantArticles
        .map(
          (a) =>
            `### หัวข้อ: ${a.title} (หมวด: ${a.category})\nสรุป: ${a.summary}\nเนื้อหา: ${a.content}\nFAQ:\n${a.faqPairs.map((f) => `Q: ${f.question} -> A: ${f.answer}`).join('\n')}`,
        )
        .join('\n\n---\n\n');

      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `
คุณคือ "TEENSTYLE Knowledge Assistant" ผู้ช่วยค้นหาและสรุปข้อมูลนโยบายร้านค้า ข้อมูลสินค้า และตารางไซซ์
กฎเหล็กสูงสุด (MANDATORY INVARIANT):
1. ตอบคำถามโดยใช้ข้อมูลจาก "เอกสารอ้างอิงที่ให้ไว้" ด้านล่างนี้เท่านั้น ห้ามแต่งนโยบาย กฎเกณฑ์ หรือข้อมูลขึ้นมาเองเด็ดขาด (No Hallucination)
2. หากในเอกสารอ้างอิงไม่มีข้อมูลที่ตอบคำถามได้ตรงจุด ให้ตอบตามตรงอย่างสุภาพว่า "ขณะนี้ยังไม่มีข้อมูลเรื่องดังกล่าวในฐานความรู้ กรุณาติดต่อฝ่ายบริการลูกค้าเพื่อรับความช่วยเหลือโดยตรงครับ"
3. สรุปคำตอบเป็นภาษาไทยที่สุภาพ กระชับ อ่านเข้าใจง่าย เป็นมิตรกับวัยรุ่น
            `.trim(),
          },
          {
            role: 'user',
            content: `เอกสารอ้างอิงจากคลังความรู้:\n${contextText}\n\nคำถามจากผู้ใช้: "${query}"`,
          },
        ],
        temperature: 0.2,
      });

      const text = completion.choices[0]?.message?.content?.trim();
      if (text) {
        return {
          answer: text,
          sourceArticles: sources,
          suggestedQuestions: suggestedQuestions.slice(0, 3),
          model: completion.model || 'gpt-4o-mini',
        };
      }
    } catch (err) {
      logger.warn({ err }, 'OpenAI knowledge answer failed; switching to intelligent fallback');
    }
  }

  // Intelligent Fallback Engine (No external API needed)
  if (relevantArticles.length === 0) {
    return {
      answer:
        'ขออภัยครับ ระบบไม่พบบทความหรือคำตอบที่ตรงกับคำค้นหาของคุณในฐานความรู้ขณะนี้ คุณสามารถเลือกดูหัวข้อยอดนิยมด้านล่าง หรือติดต่อฝ่ายบริการลูกค้าเพื่อสอบถามเจ้าหน้าที่คนจริงได้โดยตรงครับ',
      sourceArticles: [],
      suggestedQuestions: [
        'ยอดสั่งซื้อเท่าไรถึงจะได้จัดส่งฟรี?',
        'สามารถขอเปลี่ยนไซซ์ได้ภายในกี่วัน?',
        'มีช่องทางการชำระเงินใดบ้าง?',
      ],
      model: 'fallback-rules-engine',
    };
  }

  // สรุปเนื้อหาจากบทความที่ตรงที่สุด
  const topArticle = relevantArticles[0]!;
  const directFaq = topArticle.faqPairs.find(
    (f) =>
      f.question.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes(f.question.toLowerCase()),
  );

  let fallbackAnswer = '';
  if (directFaq) {
    fallbackAnswer = `${directFaq.answer}\n\n(อ้างอิงจาก: "${topArticle.title}")`;
  } else {
    fallbackAnswer = `จากการตรวจสอบฐานข้อมูลในหัวข้อ **"${topArticle.title}"**:\n\n${topArticle.summary}\n\nคุณสามารถคลิกอ่านรายละเอียดทั้งหมดได้ที่บทความด้านล่างครับ`;
  }

  return {
    answer: fallbackAnswer,
    sourceArticles: sources,
    suggestedQuestions: suggestedQuestions.slice(0, 3),
    model: 'fallback-rules-engine',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Operations
// ─────────────────────────────────────────────────────────────────────────────

/** ข้อมูลผู้ทำรายการสำหรับ AdminLog */
export interface KnowledgeActor {
  id?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * ดึงรายการบทความสำหรับแอดมิน (รวมฉบับร่าง)
 */
export async function adminListArticles(
  params: Partial<KnowledgeSearchQuery>,
): Promise<SearchArticlesResult> {
  return searchArticles({ ...params, publishedOnly: false });
}

/**
 * Prisma โยน P2002 เมื่อ slug ซ้ำ — แปลงเป็น 409 ให้ผู้ใช้เข้าใจ
 * (unique index ของฐานข้อมูลคือด่านจริง ไม่ใช่การเช็คด้วย findFirst ก่อนเขียน ซึ่งมี race condition)
 */
function rethrowDuplicateSlug(err: unknown, slug: string): never {
  if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
    throw ApiError.conflict(`Slug "${slug}" มีอยู่ในระบบแล้ว กรุณาใช้ slug อื่น`);
  }
  throw err;
}

/**
 * สร้างบทความใหม่
 */
export async function adminCreateArticle(
  input: CreateKnowledgeArticleInput,
  actor: KnowledgeActor = {},
): Promise<KnowledgeArticle> {
  await ensureSeeded();

  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeArticle.create({
        data: {
          slug: input.slug,
          title: input.title,
          category: input.category,
          summary: input.summary,
          content: input.content,
          tags: input.tags ?? [],
          isPublished: input.isPublished ?? true,
          faqPairs: {
            create: (input.faqPairs ?? []).map((faq, index) => ({
              question: faq.question,
              answer: faq.answer,
              sortOrder: index,
            })),
          },
        },
        include: articleInclude,
      });

      const dto = toArticleDto(created);

      await writeAdminLog(tx, {
        actor,
        action: 'knowledge.create',
        targetType: 'KnowledgeArticle',
        targetId: dto.id,
        after: dto as unknown as Prisma.InputJsonValue,
      });

      return dto;
    });
  } catch (err) {
    rethrowDuplicateSlug(err, input.slug);
  }
}

/**
 * อัปเดตบทความ
 *
 * ส่งเฉพาะฟิลด์ที่เปลี่ยน — ฟิลด์ที่ไม่ส่งมาจะไม่ถูกแตะ
 * `faqPairs` เป็นข้อยกเว้น: ส่งมาเมื่อไรคือแทนที่ทั้งชุด (ฟอร์มหลังบ้านส่งมาทั้งก้อนอยู่แล้ว)
 */
export async function adminUpdateArticle(
  id: string,
  input: UpdateKnowledgeArticleInput,
  actor: KnowledgeActor = {},
): Promise<KnowledgeArticle> {
  await ensureSeeded();

  const prisma = getPrisma();

  const current = await prisma.knowledgeArticle.findUnique({
    where: { id },
    include: articleInclude,
  });

  if (!current) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการแก้ไข');
  }

  const before = toArticleDto(current);

  try {
    return await prisma.$transaction(async (tx) => {
      if (input.faqPairs) {
        await tx.knowledgeFaq.deleteMany({ where: { articleId: id } });
      }

      const updated = await tx.knowledgeArticle.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
          ...(input.faqPairs
            ? {
                faqPairs: {
                  create: input.faqPairs.map((faq, index) => ({
                    question: faq.question,
                    answer: faq.answer,
                    sortOrder: index,
                  })),
                },
              }
            : {}),
        },
        include: articleInclude,
      });

      const after = toArticleDto(updated);

      await writeAdminLog(tx, {
        actor,
        action: 'knowledge.update',
        targetType: 'KnowledgeArticle',
        targetId: id,
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
      });

      return after;
    });
  } catch (err) {
    rethrowDuplicateSlug(err, input.slug ?? before.slug);
  }
}

/**
 * ลบบทความ (ลบจริง — FAQ ที่ผูกอยู่หายตามด้วย onDelete: Cascade)
 */
export async function adminDeleteArticle(
  id: string,
  actor: KnowledgeActor = {},
): Promise<{ success: boolean }> {
  await ensureSeeded();

  const prisma = getPrisma();

  const current = await prisma.knowledgeArticle.findUnique({
    where: { id },
    include: articleInclude,
  });

  if (!current) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการลบ');
  }

  const before = toArticleDto(current);

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeArticle.delete({ where: { id } });

    await writeAdminLog(tx, {
      actor,
      action: 'knowledge.delete',
      targetType: 'KnowledgeArticle',
      targetId: id,
      before: before as unknown as Prisma.InputJsonValue,
    });
  });

  return { success: true };
}

/**
 * รีเซ็ตบทความกลับเป็นค่าเริ่มต้น
 *
 * ⚠️ ลบบทความทั้งหมดรวมถึงที่แอดมินเขียนเอง แล้วใส่ชุดตั้งต้นกลับเข้าไป
 *    ทำในทรานแซกชันเดียว และเขียน AdminLog ไว้ว่าใครสั่ง
 */
export async function adminResetDefaults(actor: KnowledgeActor = {}): Promise<{ count: number }> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const removed = await tx.knowledgeArticle.count();
    await tx.knowledgeArticle.deleteMany({});

    for (const article of INITIAL_KNOWLEDGE_ARTICLES) {
      await tx.knowledgeArticle.create({
        data: {
          id: article.id,
          slug: article.slug,
          title: article.title,
          category: article.category,
          summary: article.summary,
          content: article.content,
          tags: article.tags,
          isPublished: article.isPublished,
          faqPairs: {
            create: article.faqPairs.map((faq, index) => ({
              question: faq.question,
              answer: faq.answer,
              sortOrder: index,
            })),
          },
        },
      });
    }

    await writeAdminLog(tx, {
      actor,
      action: 'knowledge.reset',
      targetType: 'KnowledgeArticle',
      before: { articleCount: removed },
      after: { articleCount: INITIAL_KNOWLEDGE_ARTICLES.length },
    });
  });

  seedChecked = true;

  return { count: INITIAL_KNOWLEDGE_ARTICLES.length };
}
