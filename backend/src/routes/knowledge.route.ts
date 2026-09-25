import { Router } from 'express';

import {
  adminCreateArticleHandler,
  adminDeleteArticleHandler,
  adminListArticlesHandler,
  adminResetDefaultsHandler,
  adminUpdateArticleHandler,
  askKnowledgeHandler,
  getArticleHandler,
  listArticlesHandler,
  listCategoriesHandler,
  voteHelpfulHandler,
} from '../controllers/knowledge-base.controller.ts';
import { requirePermission } from '../middlewares/authorize.ts';
import { strictRateLimiter } from '../middlewares/rate-limit.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

// Public Knowledge Base router
export const publicKnowledgeRouter = Router();

publicKnowledgeRouter.get('/articles', listArticlesHandler);
/**
 * อ่านบทความฉบับเต็ม — **เส้นทางนี้บวก `viewCount` ที่ฐานข้อมูล**
 *
 * จึงต้องมี `strictRateLimiter` ตามกฎ STEP 21 ข้อ 9 (endpoint ที่เพิ่มตัวนับต้องคุมความถี่)
 * ไม่งั้นยิงรัว ๆ แล้วดันยอดเข้าชมได้ ซึ่งเป็นเลขที่แอดมินใช้ตัดสินใจว่าบทความไหนสำคัญ
 *
 * ⚠️ **ต้องถูกเรียกจากเบราว์เซอร์เท่านั้น ห้ามเรียกแบบ server-to-server จาก Server Component**
 *    limit นับต่อ IP — ถ้าเรียกจากฝั่งเซิร์ฟเวอร์ของ Next ทุกคำขอจะมาจาก IP เดียว
 *    แล้วผู้ใช้ทั้งเว็บจะแชร์โควตา 20 ครั้ง/นาทีร่วมกัน (ผู้เรียกปัจจุบันคือ faq-viewer.tsx ซึ่งเป็น client component)
 */
publicKnowledgeRouter.get('/articles/:slug', strictRateLimiter, getArticleHandler);
publicKnowledgeRouter.get('/categories', listCategoriesHandler);

/**
 * ⚠️ สอง endpoint นี้เปิดสาธารณะและ "มีต้นทุน" จึงต้องคุมให้เข้มกว่าปกติ
 *   - `/ask` เรียก OpenAI ต่อหนึ่งคำขอ → ยิงรัวได้ = ค่าใช้จ่ายของร้านโดยไม่มีเพดาน
 *   - `/articles/:id/helpful` เพิ่มตัวนับโหวตและเขียนไฟล์ทุกครั้ง → ยิงรัวได้ = ปั่นคะแนน
 *     จนแอดมินอ่านสถิติผิด และเขียนดิสก์ถี่โดยไม่จำเป็น
 *
 * หมายเหตุ: ยังไม่มีการกันโหวตซ้ำรายคน (ต้องผูกกับตัวผู้โหวตซึ่งที่เก็บแบบไฟล์ทำไม่ได้ดี)
 *           rate limit จึงเป็นการ "ลดความเสียหาย" ไม่ใช่การกันขาด
 */
publicKnowledgeRouter.post('/ask', verifyOrigin, strictRateLimiter, askKnowledgeHandler);
publicKnowledgeRouter.post(
  '/articles/:id/helpful',
  verifyOrigin,
  strictRateLimiter,
  voteHelpfulHandler,
);

/**
 * Admin Knowledge Base router (Staff only)
 *
 * ⚠️ สิทธิ์ต้องเป็นของโดเมน AI ไม่ใช่ `product:*`
 *    seed มี `ai:knowledge:manage` ("จัดการคลังความรู้ที่ AI ใช้ตอบ") ไว้ให้ ADMIN ขึ้นไปอยู่แล้ว
 *    แต่ตอนสร้าง STEP 21 กลับไปยืมสิทธิ์สินค้ามาใช้ — ผลคือใครก็ตามที่ได้สิทธิ์
 *    **แก้ข้อมูลสินค้า** จะแก้ **นโยบายร้านที่ AI เอาไปตอบลูกค้าในฐานะความจริง** ได้ด้วย
 *    ซึ่งเป็นคนละเรื่องและคนละระดับความเสี่ยงกัน
 *
 *    ดู (รวมฉบับร่าง) = `ai:read` (EMPLOYEE มี) · แก้/ลบ/รีเซ็ต = `ai:knowledge:manage` (ADMIN ขึ้นไป)
 */
export const adminKnowledgeRouter = Router();

adminKnowledgeRouter.get('/articles', requirePermission('ai:read'), adminListArticlesHandler);

adminKnowledgeRouter.post(
  '/articles',
  verifyOrigin,
  requirePermission('ai:knowledge:manage'),
  adminCreateArticleHandler,
);

adminKnowledgeRouter.put(
  '/articles/:id',
  verifyOrigin,
  requirePermission('ai:knowledge:manage'),
  adminUpdateArticleHandler,
);

adminKnowledgeRouter.delete(
  '/articles/:id',
  verifyOrigin,
  requirePermission('ai:knowledge:manage'),
  adminDeleteArticleHandler,
);

adminKnowledgeRouter.post(
  '/articles/reset-defaults',
  verifyOrigin,
  requirePermission('ai:knowledge:manage'),
  adminResetDefaultsHandler,
);
