import type { Request, Response } from 'express';

import { COUPON_REJECTION_MESSAGE } from '../models/coupon.model.ts';
import {
  checkCouponForCart,
  createCoupon,
  deleteCoupon,
  listCoupons,
  updateCoupon,
} from '../services/coupon.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminCouponListQuerySchema,
  applyCouponSchema,
  createCouponSchema,
  updateCouponSchema,
} from '../validators/coupon.validator.ts';

/**
 * Endpoint ของคูปองส่วนลด (STEP 41)
 *
 * ⚠️ controller ไม่มี business logic — การตรวจและคิดส่วนลดอยู่ใน service/model
 */

function actorOf(req: Request) {
  return { id: req.user?.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/* ─────────────────────────── ฝั่งลูกค้า ─────────────────────────── */

/**
 * POST /api/coupons/apply — ตรวจคูปองกับตะกร้าของตัวเอง
 *
 * ไม่ได้ "บันทึก" อะไร — เป็นการดูผลล่วงหน้า (คูปองถูกใช้จริงตอนสร้างคำสั่งซื้อเท่านั้น)
 * คูปองที่ใช้ไม่ได้ **ตอบ 200 พร้อมเหตุผล** ไม่ใช่ error เพราะผู้ใช้ต้องรู้ว่าติดเงื่อนไขข้อไหน
 * (รหัสที่ไม่มีอยู่จริงเท่านั้นที่เป็น 404 — มาจาก service)
 */
export const applyCouponHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = applyCouponSchema.parse(req.body);
  const result = await checkCouponForCart(
    req.user!.id,
    input.code,
    input.shippingMethod ?? 'STANDARD',
  );

  sendSuccess(
    res,
    {
      applied: result.applied,
      usable: result.evaluation.ok,
      reason: result.evaluation.rejection,
      message:
        result.evaluation.rejection === null
          ? null
          : COUPON_REJECTION_MESSAGE[result.evaluation.rejection],
      discountTotal: result.evaluation.discountTotal,
      shippingDiscount: result.evaluation.shippingDiscount,
    },
    result.evaluation.ok ? 'ใช้คูปองนี้ได้' : 'ใช้คูปองนี้กับตะกร้านี้ไม่ได้',
  );
});

/* ─────────────────────────── หลังบ้าน ─────────────────────────── */

/** GET /api/admin/coupons */
export const listCouponsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminCouponListQuerySchema.parse(req.query);

  sendSuccess(res, await listCoupons(query));
});

/** POST /api/admin/coupons */
export const createCouponHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = createCouponSchema.parse(req.body);
  const coupon = await createCoupon(input, actorOf(req));

  sendSuccess(res, coupon, 'สร้างคูปองแล้ว', 201);
});

/** PATCH /api/admin/coupons/:couponId */
export const updateCouponHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = updateCouponSchema.parse(req.body);
  const coupon = await updateCoupon(req.params.couponId as string, input, actorOf(req));

  sendSuccess(res, coupon, 'บันทึกคูปองแล้ว');
});

/** DELETE /api/admin/coupons/:couponId — ปิดใช้งาน (soft delete) */
export const deleteCouponHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteCoupon(req.params.couponId as string, actorOf(req));

  sendSuccess(res, { success: true }, 'ปิดใช้งานคูปองแล้ว');
});
