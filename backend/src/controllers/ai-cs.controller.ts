import { randomUUID } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

import { isProduction } from '../config/env.ts';
import {
  escalateCsConversation,
  getCsHistory,
  resetCsConversation,
  sendCsMessage,
  type CsOwner,
} from '../services/ai-cs.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { csChatSchema, csEscalateSchema } from '../validators/ai-cs.validator.ts';

export const AI_SESSION_COOKIE = 'ai-session-id';
const COOKIE_DAYS = 30;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: COOKIE_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

/**
 * ดึงหรือสร้าง session id สำหรับ guest
 *
 * ⚠️ อ่านจาก cookie `httpOnly` เท่านั้น — **ห้ามรับ session id จาก header ที่ client ส่งมาเอง**
 *    เดิมอ่าน header `x-session-id` ก่อน cookie ซึ่งทำให้ใครก็ตามสวมเป็น guest คนอื่นได้
 *    ด้วยการเดา/ดัก session id แล้วอ่านประวัติแชต ส่งข้อความแทน และปิดบทสนทนาของเขา
 *    — ลบล้างเหตุผลทั้งหมดของการใช้ cookie ที่ JavaScript อ่านไม่ได้
 *    (และไม่มี client ในโปรเจกต์นี้ส่ง header นั้นเลย จึงมีไว้เป็นช่องโหว่อย่างเดียว)
 */
function resolveOwner(req: Request, res: Response): CsOwner {
  if (req.user?.id) {
    return { userId: req.user.id };
  }

  const cookieSessionId = req.cookies?.[AI_SESSION_COOKIE];
  let sessionId = typeof cookieSessionId === 'string' ? cookieSessionId.trim() : '';

  if (!sessionId) {
    sessionId = `ai-guest-${randomUUID()}`;
    res.cookie(AI_SESSION_COOKIE, sessionId, cookieOptions());
  }

  return { sessionId };
}

/**
 * POST /api/ai/cs/chat
 * ส่งข้อความคุยกับ AI Customer Service
 */
export const csChatHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = csChatSchema.parse(req.body);
  const owner = resolveOwner(req, res);

  const result = await sendCsMessage(owner, parsed.message, parsed.conversationId);
  sendSuccess(res, result, 'ส่งข้อความบริการลูกค้าเรียบร้อยแล้ว');
});

/**
 * GET /api/ai/cs/history
 * ดึงประวัติการสนทนา Customer Service
 */
export const csHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const owner = resolveOwner(req, res);
  const history = await getCsHistory(owner);

  sendSuccess(res, history, 'ประวัติการสนทนาฝ่ายบริการลูกค้า');
});

/**
 * POST /api/ai/cs/escalate
 * ส่งต่อให้เจ้าหน้าที่คนจริง (Human Handoff)
 */
export const csEscalateHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = csEscalateSchema.parse(req.body);
  const owner = resolveOwner(req, res);

  const result = await escalateCsConversation(owner, parsed.conversationId, parsed.reason);
  sendSuccess(res, result, 'ส่งต่อให้เจ้าหน้าที่คนจริงเรียบร้อยแล้ว');
});

/**
 * POST /api/ai/cs/reset
 * เริ่มบทสนทนา Customer Service ใหม่
 */
export const csResetHandler = asyncHandler(async (req: Request, res: Response) => {
  const owner = resolveOwner(req, res);
  const result = await resetCsConversation(owner);

  sendSuccess(res, result, 'เริ่มบทสนทนาใหม่เรียบร้อยแล้ว');
});
