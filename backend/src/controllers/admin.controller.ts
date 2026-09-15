import type { Request, Response } from 'express';

import {
  getAdminOrder,
  listAdminOrders,
  updateOrderStatus,
} from '../services/admin-order.service.ts';
import { getOverview } from '../services/admin.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminOrderListQuerySchema,
  updateOrderStatusSchema,
} from '../validators/admin.validator.ts';
import { orderNumberParamsSchema } from '../validators/order.validator.ts';

/**
 * Endpoint ของหลังบ้าน (STEP 13)
 *
 * ทุกเส้นทางผ่าน `requireAuth` + `requireStaff()` ที่ route แล้ว
 * และแต่ละ endpoint ยังตรวจสิทธิ์เฉพาะของตัวเองอีกชั้น (defence in depth)
 */

/** GET /api/admin/overview — ตัวเลขสรุปจากฐานข้อมูลจริง (ไม่มีข้อมูลตัวอย่าง) */
export const getAdminOverview = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await getOverview());
  },
);

/** GET /api/admin/orders?status=&q=&page=&limit= */
export const listAdminOrdersHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = adminOrderListQuerySchema.parse(req.query);

    sendSuccess(res, await listAdminOrders(query));
  },
);

/** GET /api/admin/orders/:orderNumber */
export const getAdminOrderHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);

    sendSuccess(res, await getAdminOrder(orderNumber));
  },
);

/** PATCH /api/admin/orders/:orderNumber/status */
export const updateOrderStatusHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);
    const input = updateOrderStatusSchema.parse(req.body);

    const order = await updateOrderStatus(
      {
        id: req.user!.id,
        // เก็บไว้ใน AdminLog เพื่อตรวจย้อนหลังได้ว่าใครเปลี่ยนจากที่ไหน
        ip: req.ip,
        userAgent: req.header('user-agent'),
      },
      orderNumber,
      input,
    );

    sendSuccess(res, order, `อัปเดตสถานะเป็น ${input.status} แล้ว`);
  },
);
