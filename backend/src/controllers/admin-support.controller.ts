import type { Request, Response } from 'express';

import {
  assignSupportAgent,
  getSupportConversationDetail,
  listSupportConversations,
  sendAgentReply,
  updateSupportStatus,
  type AdminActor,
} from '../services/admin-support.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminSupportReplySchema,
  adminSupportStatusSchema,
} from '../validators/ai-cs.validator.ts';

function toActor(req: Request): AdminActor {
  return {
    id: req.user!.id,
    name: req.user?.name,
    email: req.user?.email,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * GET /api/admin/support/conversations
 * รายการตั๋วซัพพอร์ต
 */
export const listConversationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as 'ACTIVE' | 'ESCALATED' | 'CLOSED' | undefined;
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 20;

  const result = await listSupportConversations({ status, page, limit });
  sendSuccess(res, result, 'รายการบทสนทนาฝ่ายบริการลูกค้า');
});

/**
 * GET /api/admin/support/conversations/:id
 * รายละเอียดการสนทนาพร้อมข้อความทั้งหมด
 */
export const getConversationHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params['id'] || '');
  const result = await getSupportConversationDetail(id);
  sendSuccess(res, result, 'รายละเอียดบทสนทนาฝ่ายบริการลูกค้า');
});

/**
 * POST /api/admin/support/conversations/:id/assign
 * เจ้าหน้าที่กดรับเรื่อง
 */
export const assignAgentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params['id'] || '');
  const actor = toActor(req);

  const result = await assignSupportAgent(id, actor);
  sendSuccess(res, result, 'รับเรื่องเรียบร้อยแล้ว');
});

/**
 * POST /api/admin/support/conversations/:id/messages
 * เจ้าหน้าที่ส่งข้อความตอบกลับ
 */
export const replyAgentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params['id'] || '');
  const parsed = adminSupportReplySchema.parse(req.body);
  const actor = toActor(req);

  const result = await sendAgentReply(id, actor, parsed.message);
  sendSuccess(res, result, 'ส่งข้อความตอบกลับเรียบร้อยแล้ว');
});

/**
 * PATCH /api/admin/support/conversations/:id/status
 * อัปเดตสถานะบทสนทนา (เช่น ปิดเคส)
 */
export const updateStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params['id'] || '');
  const parsed = adminSupportStatusSchema.parse(req.body);
  const actor = toActor(req);

  const result = await updateSupportStatus(id, actor, parsed.status);
  sendSuccess(res, result, 'อัปเดตสถานะเรียบร้อยแล้ว');
});
