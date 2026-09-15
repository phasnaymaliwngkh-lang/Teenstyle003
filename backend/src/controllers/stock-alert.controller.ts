import type { Request, Response } from 'express';

import {
  acknowledgeStockAlert,
  listStockAlerts,
  runStockAlertScan,
} from '../services/stock-alert.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  stockAlertAckParamsSchema,
  stockAlertListQuerySchema,
} from '../validators/stock-alert.validator.ts';

/** GET /api/admin/stock-alerts?severity= */
export const listStockAlertsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = stockAlertListQuerySchema.parse(req.query);

    sendSuccess(res, await listStockAlerts(query));
  },
);

/**
 * POST /api/admin/stock-alerts/scan — ตรวจทั้งร้านแล้วแจ้งของที่เพิ่งตกเกณฑ์
 *
 * ปกติระบบตรวจให้เองทุกครั้งที่สต็อกขยับ (สั่งซื้อ/ชำระเงิน/ยกเลิก/ปรับสต็อก)
 * ปุ่มนี้ไว้ตรวจย้อนของที่ตกเกณฑ์ไปก่อนที่ระบบแจ้งเตือนจะมีอยู่
 * และเป็นตัวเดียวกับที่ job ตามกำหนดเวลาใน STEP 52 จะเรียก
 */
export const scanStockAlertsHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const result = await runStockAlertScan();

    sendSuccess(
      res,
      result,
      result.created + result.escalated === 0
        ? `ตรวจแล้ว — ไม่มีรายการใหม่ที่ต้องแจ้ง (เข้าเกณฑ์เตือนอยู่ ${result.alerts} รายการ)`
        : `แจ้งเตือนใหม่ ${result.created + result.escalated} รายการ`,
    );
  },
);

/** PATCH /api/admin/stock-alerts/:notificationId/ack */
export const acknowledgeStockAlertHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { notificationId } = stockAlertAckParamsSchema.parse(req.params);

    await acknowledgeStockAlert(notificationId, req.user!.id);

    sendSuccess(res, { acknowledged: true }, 'รับทราบการแจ้งเตือนแล้ว');
  },
);
