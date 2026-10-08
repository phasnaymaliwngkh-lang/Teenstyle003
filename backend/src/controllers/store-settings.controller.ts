import type { Request, Response } from 'express';

import {
  adminGetStoreSettings,
  adminUpdateStoreSettings,
  getStoreInfo,
} from '../services/store-settings.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { updateStoreSettingsSchema } from '../validators/store-settings.validator.ts';

/**
 * การตั้งค่าร้าน (STEP 49) — ข้อมูลร้านที่ลูกค้าเห็น + หน้าแก้ของร้าน
 * ฝั่งร้านส่งตัวตนจริงจาก session (+ ip/user-agent) ไปให้ service เขียน AdminLog
 */

const actorOf = (req: Request) => ({
  id: req.user!.id,
  ip: req.ip,
  userAgent: req.header('user-agent'),
});

/** GET /api/store — ข้อมูลร้านสำหรับหน้าร้าน (สาธารณะ · footer และหน้าเกี่ยวกับเราอ่านจากที่นี่) */
export const getStoreInfoHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await getStoreInfo(), 'ดึงข้อมูลร้านสำเร็จ');
});

/** GET /api/admin/settings */
export const adminGetStoreSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await adminGetStoreSettings(), 'ดึงการตั้งค่าร้านสำเร็จ');
});

/** PATCH /api/admin/settings — ส่งเฉพาะช่องที่จะแก้ · null = ร้านไม่มีช่องทางนั้น */
export const adminUpdateStoreSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = updateStoreSettingsSchema.parse(req.body);

  sendSuccess(res, await adminUpdateStoreSettings(actorOf(req), input), 'บันทึกการตั้งค่าร้านแล้ว');
});
