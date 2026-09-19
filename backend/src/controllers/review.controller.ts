import type { Request, Response } from 'express';

import {
  createReview,
  deleteOwnReview,
  getReviewEligibility,
  listMyReviews,
  listProductReviews,
  setReviewHelpful,
  updateOwnReview,
} from '../services/review.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { productSlugParamsSchema } from '../validators/product.validator.ts';
import {
  createReviewSchema,
  eligibilityQuerySchema,
  helpfulSchema,
  myReviewsQuerySchema,
  productReviewQuerySchema,
  reviewParamsSchema,
  updateReviewSchema,
} from '../validators/review.validator.ts';

/**
 * Endpoint ของรีวิวสินค้า (STEP 23)
 *
 * รายการรีวิวเป็นของสาธารณะ (guest อ่านได้) — ใช้ `attachUser` ไม่ใช่ `requireAuth`
 * เพื่อให้คนที่ล็อกอินเห็นรีวิวของตัวเองที่ยังรอตรวจ และเห็นว่าเคยกด "มีประโยชน์" ไว้ที่ไหนบ้าง
 * ส่วนการเขียน/แก้/ลบ/โหวต ต้องล็อกอิน + มีสิทธิ์ `review:create` (ตรวจที่ชั้น route)
 */

/** GET /api/products/:slug/reviews?page=&limit=&sort=&rating= */
export const listProductReviewsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = productSlugParamsSchema.parse(req.params);
  const query = productReviewQuerySchema.parse(req.query);
  const result = await listProductReviews(slug, query, req.user?.id);

  sendSuccess(res, result, 'ดึงรีวิวสินค้าสำเร็จ');
});

/** GET /api/reviews/eligibility?productIds=a,b,c */
export const reviewEligibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { productIds } = eligibilityQuerySchema.parse(req.query);
  const items = await getReviewEligibility(req.user!.id, productIds);

  sendSuccess(res, { items }, 'ตรวจสิทธิ์รีวิวสำเร็จ');
});

/** GET /api/reviews/me?page=&limit= */
export const listMyReviewsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = myReviewsQuerySchema.parse(req.query);
  const result = await listMyReviews(req.user!.id, query);

  sendSuccess(res, result, 'ดึงรีวิวของฉันสำเร็จ');
});

/** POST /api/reviews { productId, rating, title?, comment } */
export const createReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = createReviewSchema.parse(req.body);
  const result = await createReview(req.user!.id, body);

  sendSuccess(res, result, 'ส่งรีวิวแล้ว — รอร้านตรวจสอบก่อนแสดงบนหน้าสินค้า', 201);
});

/** PATCH /api/reviews/:reviewId */
export const updateReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = reviewParamsSchema.parse(req.params);
  const body = updateReviewSchema.parse(req.body);
  const result = await updateOwnReview(req.user!.id, reviewId, body);

  sendSuccess(res, result, 'แก้ไขรีวิวแล้ว — รอร้านตรวจสอบอีกครั้งก่อนแสดงบนหน้าสินค้า');
});

/** DELETE /api/reviews/:reviewId */
export const deleteReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = reviewParamsSchema.parse(req.params);
  const result = await deleteOwnReview(req.user!.id, reviewId);

  sendSuccess(res, result, 'ลบรีวิวแล้ว');
});

/** PATCH /api/reviews/:reviewId/helpful { helpful } */
export const setReviewHelpfulHandler = asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = reviewParamsSchema.parse(req.params);
  const { helpful } = helpfulSchema.parse(req.body);
  const result = await setReviewHelpful(req.user!.id, reviewId, helpful);

  sendSuccess(res, result, helpful ? 'ขอบคุณสำหรับความคิดเห็น' : 'ยกเลิกการโหวตแล้ว');
});
