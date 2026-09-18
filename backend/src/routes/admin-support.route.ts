import { Router } from 'express';

import {
  assignAgentHandler,
  getConversationHandler,
  listConversationsHandler,
  replyAgentHandler,
  updateStatusHandler,
} from '../controllers/admin-support.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { requirePermission } from '../middlewares/authorize.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

export const adminSupportRouter = Router();

adminSupportRouter.use(requireAuth);

// ดูรายการและรายละเอียดตั๋ว (ต้องการสิทธิ์ ai:read)
adminSupportRouter.get('/conversations', requirePermission('ai:read'), listConversationsHandler);

adminSupportRouter.get('/conversations/:id', requirePermission('ai:read'), getConversationHandler);

// จัดการเคส ตอบกลับ และเปลี่ยนสถานะ (ต้องการสิทธิ์ ai:handoff)
adminSupportRouter.post(
  '/conversations/:id/assign',
  verifyOrigin,
  requirePermission('ai:handoff'),
  assignAgentHandler,
);

adminSupportRouter.post(
  '/conversations/:id/messages',
  verifyOrigin,
  requirePermission('ai:handoff'),
  replyAgentHandler,
);

adminSupportRouter.patch(
  '/conversations/:id/status',
  verifyOrigin,
  requirePermission('ai:handoff'),
  updateStatusHandler,
);
