import { Router } from 'express';

import {
  stylistChatHandler,
  stylistHistoryHandler,
  stylistResetHandler,
} from '../controllers/ai-stylist.controller.ts';
import {
  csChatHandler,
  csEscalateHandler,
  csHistoryHandler,
  csResetHandler,
} from '../controllers/ai-cs.controller.ts';
import { publicKnowledgeRouter } from './knowledge.route.ts';
import { attachUser } from '../middlewares/authenticate.ts';
import { strictRateLimiter } from '../middlewares/rate-limit.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * AI Routes (STEP 19: AI Stylist, STEP 20: AI CS, STEP 21: Knowledge Base, STEP 46: Recs)
 */
export const aiRouter = Router();

aiRouter.use(attachUser);

/**
 * ⚠️ endpoint ที่เรียก OpenAI ต้องคุมความถี่เป็นพิเศษ
 *    เปิดให้ guest ใช้ได้ และหนึ่งคำขอ = ค่าใช้จ่ายจริงของร้าน (บางเส้นทางเรียกสองครั้งเพราะมี tool calling)
 *    ถ้าเหลือแค่ rate limit รวมของทั้ง API ใครก็ยิงจนบิลบานได้
 */

// AI Stylist endpoints (STEP 19)
aiRouter.get('/stylist/history', stylistHistoryHandler);
aiRouter.post('/stylist/chat', verifyOrigin, strictRateLimiter, stylistChatHandler);
aiRouter.post('/stylist/reset', verifyOrigin, stylistResetHandler);

// AI Customer Service endpoints (STEP 20)
aiRouter.get('/cs/history', csHistoryHandler);
aiRouter.post('/cs/chat', verifyOrigin, strictRateLimiter, csChatHandler);
aiRouter.post('/cs/escalate', verifyOrigin, csEscalateHandler);
aiRouter.post('/cs/reset', verifyOrigin, csResetHandler);

// AI Knowledge Base endpoints (STEP 21)
aiRouter.use('/knowledge', publicKnowledgeRouter);
