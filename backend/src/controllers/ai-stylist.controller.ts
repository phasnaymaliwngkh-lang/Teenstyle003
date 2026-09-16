import { randomUUID } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

import { isProduction } from '../config/env.ts';
import {
  getStylistHistory,
  resetStylistConversation,
  sendStylistMessage,
  type StylistOwner,
} from '../services/ai-stylist.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { stylistChatSchema } from '../validators/ai.validator.ts';

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
 */
function resolveOwner(req: Request, res: Response): StylistOwner {
  if (req.user?.id) {
    return { userId: req.user.id };
  }

  // ดูจาก header หรือ cookie
  const headerSessionId = req.headers['x-session-id'];
  const cookieSessionId = req.cookies?.[AI_SESSION_COOKIE];

  let sessionId =
    (typeof headerSessionId === 'string' && headerSessionId.trim()) ||
    (typeof cookieSessionId === 'string' && cookieSessionId.trim()) ||
    '';

  if (!sessionId) {
    sessionId = `ai-guest-${randomUUID()}`;
    res.cookie(AI_SESSION_COOKIE, sessionId, cookieOptions());
  }

  return { sessionId };
}

/**
 * POST /api/ai/stylist/chat
 * ส่งข้อความคุยกับ AI Stylist
 */
export const stylistChatHandler = asyncHandler(async (req: Request, res: Response) => {
  const parsed = stylistChatSchema.parse(req.body);
  const owner = resolveOwner(req, res);

  const result = await sendStylistMessage(
    owner,
    parsed.message,
    parsed.conversationId,
    parsed.preferences,
  );

  sendSuccess(res, result, 'AI Stylist ตอบกลับเรียบร้อยแล้ว');
});

/**
 * GET /api/ai/stylist/history
 * ดึงประวัติการสนทนาของ AI Stylist
 */
export const stylistHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const owner = resolveOwner(req, res);
  const history = await getStylistHistory(owner);

  sendSuccess(res, history, 'ประวัติการสนทนา AI Stylist');
});

/**
 * POST /api/ai/stylist/reset
 * เริ่มบทสนทนาใหม่
 */
export const stylistResetHandler = asyncHandler(async (req: Request, res: Response) => {
  const owner = resolveOwner(req, res);
  const result = await resetStylistConversation(owner);

  sendSuccess(res, result, 'เริ่มบทสนทนาใหม่เรียบร้อยแล้ว');
});
