import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/async-handler.ts';
import { sendSuccess } from '../utils/api-response.ts';
import {
  adminCreateArticle,
  adminDeleteArticle,
  adminListArticles,
  adminResetDefaults,
  adminUpdateArticle,
  askKnowledgeBase,
  getArticleBySlug,
  getCategoriesSummary,
  searchArticles,
  voteArticleHelpful,
} from '../services/knowledge-base.service.ts';
import {
  askKnowledgeSchema,
  createKnowledgeArticleSchema,
  knowledgeSearchQuerySchema,
  updateKnowledgeArticleSchema,
  voteHelpfulSchema,
} from '../validators/knowledge-base.validator.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Public Endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const listArticlesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = knowledgeSearchQuerySchema.parse(req.query);
  const result = searchArticles(query);
  sendSuccess(res, result, 'ดึงรายการบทความสำเร็จ');
});

export const getArticleHandler = asyncHandler(async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const article = getArticleBySlug(slug);
  sendSuccess(res, article, 'ดึงข้อมูลบทความสำเร็จ');
});

export const listCategoriesHandler = asyncHandler(async (_req: Request, res: Response) => {
  const categories = getCategoriesSummary();
  sendSuccess(res, categories, 'ดึงหมวดหมู่ฐานความรู้สำเร็จ');
});

export const askKnowledgeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { query, category } = askKnowledgeSchema.parse(req.body);
  const result = await askKnowledgeBase(query, category);
  sendSuccess(res, result, 'ตอบคำถามจากฐานความรู้สำเร็จ');
});

export const voteHelpfulHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { helpful } = voteHelpfulSchema.parse(req.body);
  const result = voteArticleHelpful(id, helpful);
  sendSuccess(res, result, 'บันทึกคะแนนโหวตสำเร็จ');
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const adminListArticlesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = knowledgeSearchQuerySchema.parse(req.query);
  const result = adminListArticles(query);
  sendSuccess(res, result, 'ดึงรายการบทความสำหรับแอดมินสำเร็จ');
});

export const adminCreateArticleHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = createKnowledgeArticleSchema.parse(req.body);
  const article = await adminCreateArticle(input, req.user?.id);
  sendSuccess(res, article, 'สร้างบทความใหม่สำเร็จ', 201);
});

export const adminUpdateArticleHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const input = updateKnowledgeArticleSchema.parse(req.body);
  const article = await adminUpdateArticle(id, input, req.user?.id);
  sendSuccess(res, article, 'อัปเดตบทความสำเร็จ');
});

export const adminDeleteArticleHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await adminDeleteArticle(id, req.user?.id);
  sendSuccess(res, result, 'ลบบทความสำเร็จ');
});

export const adminResetDefaultsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = adminResetDefaults();
  sendSuccess(res, result, 'รีเซ็ตบทความกลับเป็นค่าเริ่มต้นสำเร็จ');
});
