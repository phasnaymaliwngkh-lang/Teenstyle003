import type { Request, Response } from 'express';

import {
  adminListReviews,
  adminModerateReview,
  type ReviewActor,
} from '../services/review.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminReviewQuerySchema,
  moderateReviewSchema,
  reviewParamsSchema,
} from '../validators/review.validator.ts';

/** ผู้ทำรายการ — บันทึกลง AdminLog ทุกครั้งที่เปลี่ยนสถานะรีวิว */
function actorOf(req: Request): ReviewActor {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/** GET /api/admin/reviews?status=&rating=&q=&page=&limit= */
export const listAdminReviewsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminReviewQuerySchema.parse(req.query);
  const result = await adminListReviews(query);

  sendSuccess(res, result, 'ดึงรายการรีวิวสำเร็จ');
});

/** PATCH /api/admin/reviews/:reviewId/status { status, adminNote? } */
export const moderateReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = reviewParamsSchema.parse(req.params);
  const body = moderateReviewSchema.parse(req.body);
  const review = await adminModerateReview(reviewId, body, actorOf(req));

  sendSuccess(res, review, 'บันทึกผลการตรวจรีวิวแล้ว');
});
