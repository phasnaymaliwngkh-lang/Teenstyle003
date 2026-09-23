import type { Request, Response } from 'express';

import {
  exportAdminLogs,
  getAdminLogFilters,
  getTargetHistory,
  listAdminLogs,
} from '../services/admin-log.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminLogExportQuerySchema,
  adminLogFilterQuerySchema,
  adminLogQuerySchema,
  targetHistoryParamsSchema,
} from '../validators/admin-log.validator.ts';

/**
 * Audit log (STEP 27)
 *
 * ⚠️ **มีแต่ GET โดยเจตนา** — ไม่มี endpoint สร้าง แก้ หรือลบ log
 *    audit log ที่แก้ได้คือ audit log ที่เชื่อไม่ได้
 *    (แพตเทิร์นเดียวกับประวัติสต็อกที่เป็น append-only ใน STEP 15 ข้อ 7)
 */

/** GET /api/admin/logs?q=&group=&action=&targetType=&targetId=&userId=&from=&to=&page=&limit= */
export const listAdminLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminLogQuerySchema.parse(req.query);
  const result = await listAdminLogs(query);

  sendSuccess(res, result, 'ดึงประวัติการแก้ไขสำเร็จ');
});

/** GET /api/admin/logs/filters?from=&to= — ตัวเลือกที่มีข้อมูลจริงในช่วงนั้น */
export const adminLogFiltersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminLogFilterQuerySchema.parse(req.query);
  const result = await getAdminLogFilters(query);

  sendSuccess(res, result, 'ดึงตัวเลือกตัวกรองสำเร็จ');
});

/** GET /api/admin/logs/export?...&format=csv|xlsx */
export const exportAdminLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminLogExportQuerySchema.parse(req.query);
  const result = await exportAdminLogs(query);

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.buffer);
});

/** GET /api/admin/logs/target/:targetType/:targetId — ประวัติของของชิ้นเดียว */
export const targetHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { targetType, targetId } = targetHistoryParamsSchema.parse(req.params);
  const result = await getTargetHistory(targetType, targetId);

  sendSuccess(res, result, 'ดึงประวัติของรายการนี้สำเร็จ');
});
