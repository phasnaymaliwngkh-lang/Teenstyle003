import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getPrisma, type Prisma } from '@teenstyle/database';
import OpenAI from 'openai';

import { env } from '../config/env.ts';
import { ApiError } from '../utils/api-error.ts';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'knowledge-base.json');

// In-memory cache synced with persistent file
let articlesCache: KnowledgeArticle[] | null = null;

function ensureDataFile(): KnowledgeArticle[] {
  if (articlesCache) return articlesCache;

  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    if (existsSync(DATA_FILE)) {
      const content = readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content) as KnowledgeArticle[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        articlesCache = parsed;
        return articlesCache;
      }
    }

    // Initialize with initial verified articles
    articlesCache = [...INITIAL_KNOWLEDGE_ARTICLES];
    writeFileSync(DATA_FILE, JSON.stringify(articlesCache, null, 2), 'utf-8');
    return articlesCache;
  } catch (err) {
    logger.error({ err }, 'Failed to read knowledge base data file; using in-memory defaults');
    articlesCache = [...INITIAL_KNOWLEDGE_ARTICLES];
    return articlesCache;
  }
}

function persistArticles(articles: KnowledgeArticle[]): void {
  articlesCache = articles;
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(DATA_FILE, JSON.stringify(articles, null, 2), 'utf-8');
  } catch (err) {
    logger.error({ err }, 'Failed to persist knowledge base data file');
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
 */
export function searchArticles(
  params: Partial<KnowledgeSearchQuery> & { publishedOnly?: boolean },
): SearchArticlesResult {
  const all = ensureDataFile();
  const publishedOnly = params.publishedOnly ?? true;

  let filtered = all.filter((a) => (publishedOnly ? a.isPublished : true));

  if (params.category) {
    filtered = filtered.filter((a) => a.category === params.category);
  }

  if (params.tag) {
    const targetTag = params.tag.toLowerCase();
    filtered = filtered.filter((a) =>
      a.tags.some((t) => t.toLowerCase() === targetTag || t.toLowerCase().includes(targetTag)),
    );
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
  } else {
    filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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
 */
export function getArticleBySlug(slug: string): KnowledgeArticle {
  const articles = ensureDataFile();
  const index = articles.findIndex((a) => a.slug === slug && a.isPublished);
  if (index === -1) {
    throw ApiError.notFound(`ไม่พบบทความความรู้สำหรับ "${slug}"`);
  }

  const article = { ...articles[index]!, viewCount: (articles[index]!.viewCount || 0) + 1 };
  articles[index] = article;
  persistArticles(articles);

  return article;
}

/**
 * สรุปหมวดหมู่บทความความรู้พร้อมจำนวนบทความในแต่ละหมวด
 */
export function getCategoriesSummary(): Array<KnowledgeCategoryMeta & { articleCount: number }> {
  const articles = ensureDataFile().filter((a) => a.isPublished);
  return KNOWLEDGE_CATEGORIES.map((cat) => {
    const count = articles.filter((a) => a.category === cat.key).length;
    return { ...cat, articleCount: count };
  });
}

/**
 * โหวตว่าบทความมีประโยชน์หรือไม่
 */
export function voteArticleHelpful(
  articleId: string,
  helpful: boolean,
): { helpfulCount: number; notHelpfulCount: number } {
  const articles = ensureDataFile();
  const index = articles.findIndex((a) => a.id === articleId);
  if (index === -1) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการโหวต');
  }

  const article = { ...articles[index]! };
  if (helpful) {
    article.helpfulCount = (article.helpfulCount || 0) + 1;
  } else {
    article.notHelpfulCount = (article.notHelpfulCount || 0) + 1;
  }
  articles[index] = article;
  persistArticles(articles);

  return {
    helpfulCount: article.helpfulCount,
    notHelpfulCount: article.notHelpfulCount,
  };
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
  const searchRes = searchArticles({ q: query, category, limit: 3, publishedOnly: true });
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

/**
 * ดึงรายการบทความสำหรับแอดมิน (รวมฉบับร่าง)
 */
export function adminListArticles(params: Partial<KnowledgeSearchQuery>): SearchArticlesResult {
  return searchArticles({ ...params, publishedOnly: false });
}

/**
 * สร้างบทความใหม่
 */
export async function adminCreateArticle(
  input: CreateKnowledgeArticleInput,
  adminUserId?: string,
): Promise<KnowledgeArticle> {
  const articles = ensureDataFile();
  if (articles.some((a) => a.slug === input.slug)) {
    throw ApiError.conflict(`Slug "${input.slug}" มีอยู่ในระบบแล้ว กรุณาใช้ slug อื่น`);
  }

  const now = new Date().toISOString();
  const newArticle: KnowledgeArticle = {
    id: randomUUID(),
    slug: input.slug,
    title: input.title,
    category: input.category,
    summary: input.summary,
    content: input.content,
    tags: input.tags ?? [],
    faqPairs: (input.faqPairs ?? []).map((faq) => ({
      id: faq.id || `faq-${randomUUID().slice(0, 8)}`,
      question: faq.question,
      answer: faq.answer,
    })),
    isPublished: input.isPublished ?? true,
    viewCount: 0,
    helpfulCount: 0,
    notHelpfulCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  articles.unshift(newArticle);
  persistArticles(articles);

  // Write AdminLog audit trail (safely ignore if db unavailable)
  try {
    const prisma = getPrisma();
    await prisma.adminLog
      .create({
        data: {
          userId: adminUserId ?? null,
          action: 'knowledge.create',
          targetType: 'KNOWLEDGE_ARTICLE',
          targetId: newArticle.id,
          after: newArticle as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  } catch {
    // Ignore logging error when db offline
  }

  return newArticle;
}

/**
 * อัปเดตบทความ
 */
export async function adminUpdateArticle(
  id: string,
  input: UpdateKnowledgeArticleInput,
  adminUserId?: string,
): Promise<KnowledgeArticle> {
  const articles = ensureDataFile();
  const index = articles.findIndex((a) => a.id === id);
  if (index === -1) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการแก้ไข');
  }

  const current = articles[index]!;

  if (input.slug && input.slug !== current.slug) {
    if (articles.some((a) => a.slug === input.slug && a.id !== id)) {
      throw ApiError.conflict(`Slug "${input.slug}" มีอยู่ในระบบแล้ว กรุณาใช้ slug อื่น`);
    }
  }

  const updated: KnowledgeArticle = {
    ...current,
    title: input.title ?? current.title,
    slug: input.slug ?? current.slug,
    category: input.category ?? current.category,
    summary: input.summary ?? current.summary,
    content: input.content ?? current.content,
    tags: input.tags ?? current.tags,
    faqPairs: input.faqPairs
      ? input.faqPairs.map((f) => ({
          id: f.id || `faq-${randomUUID().slice(0, 8)}`,
          question: f.question,
          answer: f.answer,
        }))
      : current.faqPairs,
    isPublished: input.isPublished !== undefined ? input.isPublished : current.isPublished,
    updatedAt: new Date().toISOString(),
  };

  articles[index] = updated;
  persistArticles(articles);

  // Write AdminLog audit trail (safely ignore if db unavailable)
  try {
    const prisma = getPrisma();
    await prisma.adminLog
      .create({
        data: {
          userId: adminUserId ?? null,
          action: 'knowledge.update',
          targetType: 'KNOWLEDGE_ARTICLE',
          targetId: updated.id,
          before: current as unknown as Prisma.InputJsonValue,
          after: updated as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  } catch {
    // Ignore logging error when db offline
  }

  return updated;
}

/**
 * ลบบทความ
 */
export async function adminDeleteArticle(
  id: string,
  adminUserId?: string,
): Promise<{ success: boolean }> {
  const articles = ensureDataFile();
  const index = articles.findIndex((a) => a.id === id);
  if (index === -1) {
    throw ApiError.notFound('ไม่พบบทความที่ต้องการลบ');
  }

  const deleted = articles.splice(index, 1)[0];
  persistArticles(articles);

  // Write AdminLog audit trail (safely ignore if db unavailable)
  try {
    const prisma = getPrisma();
    await prisma.adminLog
      .create({
        data: {
          userId: adminUserId ?? null,
          action: 'knowledge.delete',
          targetType: 'KNOWLEDGE_ARTICLE',
          targetId: id,
          before: deleted as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});
  } catch {
    // Ignore logging error when db offline
  }

  return { success: true };
}

/**
 * รีเซ็ตบทความกลับเป็นค่าเริ่มต้น
 */
export function adminResetDefaults(): { count: number } {
  articlesCache = [...INITIAL_KNOWLEDGE_ARTICLES];
  persistArticles(articlesCache);
  return { count: articlesCache.length };
}
