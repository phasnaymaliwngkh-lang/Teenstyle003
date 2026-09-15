import type { Request, Response } from 'express';

import {
  createOrder,
  getCheckoutSummary,
  getOrderByNumber,
  listOrders,
} from '../services/order.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  checkoutSummaryQuerySchema,
  createOrderSchema,
  orderListQuerySchema,
  orderNumberParamsSchema,
} from '../validators/order.validator.ts';

/**
 * Endpoint ของการสั่งซื้อ (STEP 10) — ทุกเส้นทางต้องล็อกอิน (requireAuth ที่ route)
 * `req.user` จึงมีค่าแน่นอน
 */

/** GET /api/checkout/summary?shippingMethod=STANDARD */
export const getCheckoutSummaryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { shippingMethod } = checkoutSummaryQuerySchema.parse(req.query);

    const summary = await getCheckoutSummary(req.user!.id, shippingMethod);

    sendSuccess(res, summary);
  },
);

/** POST /api/orders — สร้างคำสั่งซื้อจากรายการที่เลือกไว้ในตะกร้า */
export const createOrderHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const input = createOrderSchema.parse(req.body);

    const result = await createOrder(req.user!.id, input);

    sendSuccess(
      res,
      result.order,
      result.created ? 'สร้างคำสั่งซื้อแล้ว' : 'คำสั่งซื้อนี้ถูกสร้างไว้แล้ว',
      result.created ? 201 : 200,
    );
  },
);

/** GET /api/orders?status=&page=&limit= — ประวัติคำสั่งซื้อของตัวเอง (STEP 12) */
export const listOrdersHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = orderListQuerySchema.parse(req.query);

    const result = await listOrders(req.user!.id, query);

    sendSuccess(res, result);
  },
);

/** GET /api/orders/:orderNumber — ดูคำสั่งซื้อของตัวเอง */
export const getOrderHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { orderNumber } = orderNumberParamsSchema.parse(req.params);

  const order = await getOrderByNumber(req.user!.id, orderNumber);

  sendSuccess(res, order);
});
