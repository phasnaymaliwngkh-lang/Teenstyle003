import type { Request, Response } from 'express';

import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  notificationParamsSchema,
  notificationQuerySchema,
} from '../validators/notification.validator.ts';

/**
 * Endpoint การแจ้งเตือนของผู้ใช้ (STEP 24)
 *
 * ทุกเส้นทางผ่าน `requireAuth` มาแล้วที่ชั้น route จึงอ่าน `req.user!.id` ได้ตรง ๆ
 * และ **ทุก service กรอง `userId` เองอีกชั้น** (defence in depth แบบเดียวกับ `/api/orders`)
 */

/** GET /api/notifications?page=&limit=&unreadOnly=&group= */
export const listNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = notificationQuerySchema.parse(req.query);
  const result = await listNotifications(req.user!.id, query);

  sendSuccess(res, result, 'ดึงการแจ้งเตือนสำเร็จ');
});

/**
 * GET /api/notifications/unread-count
 *
 * แยกเป็น endpoint เล็ก ๆ เพราะกระดิ่งบน navbar เรียกทุกหน้า
 * ไม่ควรต้องดึงรายการทั้งหน้ามาเพื่อเอาเลขตัวเดียว
 */
export const unreadCountHandler = asyncHandler(async (req: Request, res: Response) => {
  const unreadCount = await countUnreadNotifications(req.user!.id);

  sendSuccess(res, { unreadCount }, 'นับการแจ้งเตือนที่ยังไม่อ่านสำเร็จ');
});

/** PATCH /api/notifications/:notificationId/read */
export const markReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const { notificationId } = notificationParamsSchema.parse(req.params);
  const notification = await markNotificationRead(req.user!.id, notificationId);

  sendSuccess(res, notification, 'ทำเครื่องหมายว่าอ่านแล้ว');
});

/** PATCH /api/notifications/read-all */
export const markAllReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await markAllNotificationsRead(req.user!.id);

  sendSuccess(res, result, 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด');
});
