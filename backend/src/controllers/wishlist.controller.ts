import type { Request, Response } from 'express';

import {
  addToWishlist,
  findWishlistedProductIds,
  listWishlist,
  removeFromWishlist,
  setPriceDropNotify,
} from '../services/wishlist.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  addWishlistItemSchema,
  notifyPreferenceSchema,
  wishlistContainsSchema,
  wishlistProductParamsSchema,
  wishlistQuerySchema,
} from '../validators/wishlist.validator.ts';

/**
 * Endpoint ของรายการที่ถูกใจ (STEP 22)
 *
 * ทุกเส้นทางผ่าน `requireAuth` + `requirePermission('wishlist:manage')` มาแล้วที่ชั้น route
 * จึงอ่าน `req.user!.id` ได้ตรง ๆ — และ **ทุก service กรอง `userId` เองอีกชั้น**
 * (defence in depth แบบเดียวกับ `/api/admin`)
 */

/** GET /api/wishlist?page=&limit=&sort=&onlyPriceDrop= */
export const listWishlistHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = wishlistQuerySchema.parse(req.query);
  const result = await listWishlist(req.user!.id, query);

  sendSuccess(res, result, 'ดึงรายการที่ถูกใจสำเร็จ');
});

/** POST /api/wishlist/items { productId } */
export const addWishlistItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = addWishlistItemSchema.parse(req.body);
  const result = await addToWishlist(req.user!.id, productId);

  sendSuccess(
    res,
    result,
    result.created ? 'เพิ่มเข้ารายการที่ถูกใจแล้ว' : 'สินค้าชิ้นนี้อยู่ในรายการที่ถูกใจอยู่แล้ว',
    result.created ? 201 : 200,
  );
});

/** DELETE /api/wishlist/items/:productId */
export const removeWishlistItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = wishlistProductParamsSchema.parse(req.params);
  const result = await removeFromWishlist(req.user!.id, productId);

  sendSuccess(res, result, 'นำออกจากรายการที่ถูกใจแล้ว');
});

/** PATCH /api/wishlist/items/:productId/notify { notifyOnPriceDrop } */
export const updateNotifyPreferenceHandler = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = wishlistProductParamsSchema.parse(req.params);
  const { notifyOnPriceDrop } = notifyPreferenceSchema.parse(req.body);
  const result = await setPriceDropNotify(req.user!.id, productId, notifyOnPriceDrop);

  sendSuccess(res, result, 'บันทึกการตั้งค่าแจ้งเตือนราคาแล้ว');
});

/**
 * GET /api/wishlist/contains?productIds=a,b,c
 *
 * ใช้ให้ปุ่มหัวใจแสดงสถานะถูกต้องตั้งแต่ครั้งแรกที่เปิดหน้า
 * แยกออกมาเป็น endpoint ของตัวเองเพื่อไม่ให้ต้องใส่ข้อมูลรายบุคคลลงใน
 * `/api/products/:slug` ซึ่งเป็น endpoint สาธารณะที่แคชร่วมกันทุกคน
 */
export const wishlistContainsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { productIds } = wishlistContainsSchema.parse(req.query);
  const wishlisted = await findWishlistedProductIds(req.user!.id, productIds);

  sendSuccess(res, { productIds: wishlisted }, 'ตรวจรายการที่ถูกใจสำเร็จ');
});
