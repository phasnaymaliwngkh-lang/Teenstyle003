import { Router } from 'express';

import {
  addWishlistItemHandler,
  listWishlistHandler,
  removeWishlistItemHandler,
  updateNotifyPreferenceHandler,
  wishlistContainsHandler,
} from '../controllers/wishlist.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { requirePermission } from '../middlewares/authorize.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของรายการที่ถูกใจ (STEP 22)
 *
 * - **ต้องล็อกอินทุกเส้นทาง** — `Wishlist.userId` เป็น non-nullable ไม่มีแบบ guest
 *   (ต่างจากตะกร้าที่ guest ใช้ได้ด้วย cookie)
 * - `wishlist:manage` เป็นสิทธิ์ของ CUSTOMER ตาม seed — ตรวจที่ฐานข้อมูล ไม่ได้ hard-code ตามบทบาท
 * - `verifyOrigin` ทุกเส้นทาง กัน CSRF (production ใช้ SameSite=None จึงต้องตรวจ Origin เอง)
 */
export const wishlistRouter = Router();

wishlistRouter.use(verifyOrigin, requireAuth, requirePermission('wishlist:manage'));

wishlistRouter.get('/', listWishlistHandler);
wishlistRouter.get('/contains', wishlistContainsHandler);
wishlistRouter.post('/items', addWishlistItemHandler);
wishlistRouter.delete('/items/:productId', removeWishlistItemHandler);
wishlistRouter.patch('/items/:productId/notify', updateNotifyPreferenceHandler);
