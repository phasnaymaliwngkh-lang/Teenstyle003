import type { Request, Response } from 'express';

import type { CustomerActor } from '../services/admin-customer.service.ts';
import {
  adjustCustomerPoints,
  adminListPointTransactions,
  getMyLoyalty,
  listMyPointTransactions,
} from '../services/loyalty.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { customerParamsSchema } from '../validators/customer.validator.ts';
import {
  adjustPointsSchema,
  pointTransactionQuerySchema,
} from '../validators/loyalty.validator.ts';

/**
 * แต้มสะสม (STEP 42)
 *
 * ฝั่งลูกค้าอ่าน `req.user!.id` เป็นเจ้าของเสมอ — ไม่มีทางส่ง userId มาดูแต้มของคนอื่น
 * ฝั่งร้านส่ง **บทบาทจริงจาก session** ไปให้ service (กฎ "แตะได้แค่บัญชีที่ต่ำกว่า" ของ STEP 25)
 */

/** GET /api/users/me/loyalty */
export const getMyLoyaltyHandler = asyncHandler(async (req: Request, res: Response) => {
  const loyalty = await getMyLoyalty(req.user!.id);

  sendSuccess(res, loyalty, 'ดึงข้อมูลแต้มสะสมสำเร็จ');
});

/** GET /api/users/me/loyalty/transactions?page=&limit= */
export const listMyPointTransactionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = pointTransactionQuerySchema.parse(req.query);
  const result = await listMyPointTransactions(req.user!.id, query);

  sendSuccess(res, result, 'ดึงประวัติแต้มสำเร็จ');
});

/** GET /api/admin/customers/:userId/points?page=&limit= */
export const adminListPointTransactionsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = customerParamsSchema.parse(req.params);
    const query = pointTransactionQuerySchema.parse(req.query);
    const result = await adminListPointTransactions(userId, query);

    sendSuccess(res, result, 'ดึงประวัติแต้มของลูกค้าสำเร็จ');
  },
);

/** POST /api/admin/customers/:userId/points { delta, reason, idempotencyKey } */
export const adjustCustomerPointsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = customerParamsSchema.parse(req.params);
  const body = adjustPointsSchema.parse(req.body);
  const actor: CustomerActor = {
    id: req.user!.id,
    role: req.user!.role,
    ip: req.ip,
    userAgent: req.header('user-agent'),
  };

  const result = await adjustCustomerPoints(userId, body, actor);

  sendSuccess(res, result, result.applied ? 'ปรับแต้มแล้ว' : 'รายการนี้ถูกบันทึกไปแล้ว');
});
