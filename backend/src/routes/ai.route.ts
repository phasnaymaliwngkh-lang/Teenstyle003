import { Router } from 'express';

import {
  stylistChatHandler,
  stylistHistoryHandler,
  stylistResetHandler,
} from '../controllers/ai-stylist.controller.ts';
import { attachUser } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * AI Routes (STEP 19: AI Stylist, STEP 20: AI CS, STEP 21: Knowledge Base, STEP 46: Recs)
 */
export const aiRouter = Router();

aiRouter.use(attachUser);

// AI Stylist endpoints
aiRouter.get('/stylist/history', stylistHistoryHandler);
aiRouter.post('/stylist/chat', verifyOrigin, stylistChatHandler);
aiRouter.post('/stylist/reset', verifyOrigin, stylistResetHandler);
