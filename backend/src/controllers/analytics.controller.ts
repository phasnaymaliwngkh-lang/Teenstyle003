import type { Request, Response } from 'express';

import {
  exportAnalyticsReport,
  getCustomerRanking,
  getProductPerformance,
  getSalesBreakdown,
  getSalesSummary,
} from '../services/analytics.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  analyticsExportQuerySchema,
  analyticsRangeSchema,
  customerRankingQuerySchema,
  productPerformanceQuerySchema,
} from '../validators/analytics.validator.ts';

/**
 * รายงานยอดขาย (STEP 26)
 *
 * ทุก endpoint เป็น **GET** โดยเจตนา: หน้ารายงานเป็น Server Component ที่เรียก backend
 * แบบ server-to-server ซึ่งไม่มี header `Origin` → `verifyOrigin` จะบล็อก POST แบบนั้น
 * ตอน production (บทเรียนเดียวกับแผ่นป้ายบาร์โค้ดของ STEP 17 ข้อ 7)
 */

/** GET /api/admin/analytics/summary?from=&to=&granularity= */
export const salesSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = analyticsRangeSchema.parse(req.query);
  const result = await getSalesSummary(query);

  sendSuccess(res, result, 'ดึงสรุปยอดขายสำเร็จ');
});

/** GET /api/admin/analytics/products?from=&to=&sort=&page=&limit= */
export const productPerformanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = productPerformanceQuerySchema.parse(req.query);
  const result = await getProductPerformance(query);

  sendSuccess(res, result, 'ดึงอันดับสินค้าสำเร็จ');
});

/** GET /api/admin/analytics/customers?from=&to=&sort=&page=&limit= */
export const customerRankingHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = customerRankingQuerySchema.parse(req.query);
  const result = await getCustomerRanking(query);

  sendSuccess(res, result, 'ดึงอันดับลูกค้าสำเร็จ');
});

/** GET /api/admin/analytics/breakdown?from=&to= */
export const salesBreakdownHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = analyticsRangeSchema.parse(req.query);
  const result = await getSalesBreakdown(query);

  sendSuccess(res, result, 'ดึงยอดขายแยกตามมิติสำเร็จ');
});

/** GET /api/admin/analytics/export?from=&to=&format=csv|excel */
export const exportAnalyticsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = analyticsExportQuerySchema.parse(req.query);
  const result = await exportAnalyticsReport(query);

  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.buffer);
});
