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
import { verifyOrigin } from '../middlewares/verify-origin.ts';

// Public Knowledge Base router
export const publicKnowledgeRouter = Router();

publicKnowledgeRouter.get('/articles', listArticlesHandler);
publicKnowledgeRouter.get('/articles/:slug', getArticleHandler);
publicKnowledgeRouter.get('/categories', listCategoriesHandler);
publicKnowledgeRouter.post('/ask', verifyOrigin, askKnowledgeHandler);
publicKnowledgeRouter.post('/articles/:id/helpful', verifyOrigin, voteHelpfulHandler);

// Admin Knowledge Base router (Staff only)
export const adminKnowledgeRouter = Router();

adminKnowledgeRouter.get('/articles', requirePermission('product:read'), adminListArticlesHandler);

adminKnowledgeRouter.post(
  '/articles',
  verifyOrigin,
  requirePermission('product:create'),
  adminCreateArticleHandler,
);

adminKnowledgeRouter.put(
  '/articles/:id',
  verifyOrigin,
  requirePermission('product:update'),
  adminUpdateArticleHandler,
);

adminKnowledgeRouter.delete(
  '/articles/:id',
  verifyOrigin,
  requirePermission('product:delete'),
  adminDeleteArticleHandler,
);

adminKnowledgeRouter.post(
  '/articles/reset-defaults',
  verifyOrigin,
  requirePermission('product:update'),
  adminResetDefaultsHandler,
);
