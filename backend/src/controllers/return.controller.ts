import type { Request, Response } from 'express';

import {
  adminDecideReturn,
  adminGetReturn,
  adminListReturns,
  adminReceiveReturn,
  adminRefundCancelledOrder,
  adminRefundReturn,
  cancelMyReturn,
  createReturnRequest,
  getReturnEligibility,
  listMyReturns,
} from '../services/return.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { orderNumberParamsSchema } from '../validators/order.validator.ts';
import {
  adminReturnQuerySchema,
  createReturnSchema,
  decideReturnSchema,
  receiveReturnSchema,
  recordRefundSchema,
  returnListQuerySchema,
  returnParamsSchema,
} from '../validators/return.validator.ts';

/**
 * คืนสินค้าและคืนเงิน (STEP 43)
 *
 * ฝั่งลูกค้าอ่าน `req.user!.id` เป็นเจ้าของเสมอ — ไม่มีทางส่ง userId มาดู/ยกเลิกคำขอของคนอื่น
 * ฝั่งร้านส่งตัวตนจริงจาก session (+ ip/user-agent) ไปให้ service เขียน AdminLog
 */

const actorOf = (req: Request) => ({
  id: req.user!.id,
  ip: req.ip,
  userAgent: req.header('user-agent'),
});

/** GET /api/returns?page=&limit= */
export const listMyReturnsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = returnListQuerySchema.parse(req.query);
  const result = await listMyReturns(req.user!.id, query);

  sendSuccess(res, result, 'ดึงคำขอคืนสินค้าสำเร็จ');
});

/** GET /api/returns/eligibility/:orderNumber */
export const getReturnEligibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber } = orderNumberParamsSchema.parse(req.params);
  const result = await getReturnEligibility(req.user!.id, orderNumber);

  sendSuccess(res, result, 'ตรวจสิทธิ์การคืนสินค้าสำเร็จ');
});

/** POST /api/returns { orderNumber, reason, detail, items, idempotencyKey } */
export const createReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = createReturnSchema.parse(req.body);
  const { request, created } = await createReturnRequest(req.user!.id, body);

  sendSuccess(
    res,
    request,
    created ? 'ส่งคำขอคืนสินค้าแล้ว' : 'คำขอนี้ถูกส่งไปแล้ว',
    created ? 201 : 200,
  );
});

/** POST /api/returns/:returnId/cancel */
export const cancelMyReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = returnParamsSchema.parse(req.params);
  const result = await cancelMyReturn(req.user!.id, returnId);

  sendSuccess(res, result, 'ยกเลิกคำขอคืนสินค้าแล้ว');
});

/* ─────────────────────────────── หลังบ้าน ─────────────────────────────── */

/** GET /api/admin/returns?status=&q=&page=&limit= */
export const adminListReturnsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminReturnQuerySchema.parse(req.query);
  const result = await adminListReturns(query);

  sendSuccess(res, result, 'ดึงคำขอคืนสินค้าสำเร็จ');
});

/** GET /api/admin/returns/:returnId */
export const adminGetReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = returnParamsSchema.parse(req.params);
  const result = await adminGetReturn(returnId);

  sendSuccess(res, result, 'ดึงคำขอคืนสินค้าสำเร็จ');
});

/** PATCH /api/admin/returns/:returnId/status { status: APPROVED|REJECTED, note } */
export const adminDecideReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = returnParamsSchema.parse(req.params);
  const body = decideReturnSchema.parse(req.body);
  const result = await adminDecideReturn(actorOf(req), returnId, body);

  sendSuccess(
    res,
    result,
    body.status === 'APPROVED' ? 'อนุมัติคำขอแล้ว' : 'บันทึกว่าไม่รับคืนแล้ว',
  );
});

/** POST /api/admin/returns/:returnId/receive { items: [{ returnItemId, restock }], note } */
export const adminReceiveReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = returnParamsSchema.parse(req.params);
  const body = receiveReturnSchema.parse(req.body);
  const result = await adminReceiveReturn(actorOf(req), returnId, body);

  sendSuccess(res, result, 'บันทึกการตรวจรับสินค้าแล้ว');
});

/** POST /api/admin/returns/:returnId/refund { method, reference, note, idempotencyKey } */
export const adminRefundReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const { returnId } = returnParamsSchema.parse(req.params);
  const body = recordRefundSchema.parse(req.body);
  const { applied, result } = await adminRefundReturn(actorOf(req), returnId, body);

  sendSuccess(
    res,
    { applied, ...result },
    applied ? 'บันทึกการคืนเงินแล้ว' : 'รายการนี้ถูกบันทึกไปแล้ว',
  );
});

/** POST /api/admin/orders/:orderNumber/refund { method, reference, note, idempotencyKey } */
export const adminRefundCancelledOrderHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);
    const body = recordRefundSchema.parse(req.body);
    const { applied, result } = await adminRefundCancelledOrder(actorOf(req), orderNumber, body);

    sendSuccess(
      res,
      { applied, ...result },
      applied ? 'บันทึกการคืนเงินแล้ว' : 'รายการนี้ถูกบันทึกไปแล้ว',
    );
  },
);
