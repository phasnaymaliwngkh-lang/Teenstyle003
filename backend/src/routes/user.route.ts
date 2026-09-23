import { Router } from 'express';

import {
  createMyAddressHandler,
  deleteMyAddressHandler,
  getMyProfileHandler,
  listMyAddressesHandler,
  setMyDefaultAddressHandler,
  updateMyAddressHandler,
  updateMyProfileHandler,
} from '../controllers/customer.controller.ts';
import { getMe } from '../controllers/user.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * ข้อมูลของผู้ใช้ที่ล็อกอินอยู่ (STEP 3 · ขยายใน STEP 25)
 *
 * - **ต้องล็อกอินทุกเส้นทาง** และเจ้าของข้อมูลมาจาก session เท่านั้น
 *   ไม่มีเส้นทางใดรับ `userId` จาก client → ไม่มีช่องอ่าน/แก้ข้อมูลของคนอื่น
 *   ไม่ต้องมีสิทธิ์พิเศษเพิ่ม (แพตเทิร์นเดียวกับ `/api/orders` และ `/api/notifications`):
 *   ขอบเขตความปลอดภัยคือ "เป็นเจ้าของแถวไหม" ไม่ใช่ "มีสิทธิ์อะไร"
 * - `verifyOrigin` ทุกเส้นทาง กัน CSRF — production ใช้ `SameSite=None` จึงต้องตรวจ Origin เอง
 * - **บทบาท สถานะ แต้ม ระดับสมาชิก และอีเมล แก้ทางนี้ไม่ได้** (ดู customer.validator.ts)
 *   การเปลี่ยนค่าพวกนั้นเป็นงานของหลังบ้าน `/api/admin/customers/*`
 */
export const userRouter = Router();

userRouter.use(verifyOrigin, requireAuth);

userRouter.get('/me', getMe);

// ข้อมูลส่วนตัว (STEP 25)
userRouter.get('/me/profile', getMyProfileHandler);
userRouter.patch('/me/profile', updateMyProfileHandler);

// สมุดที่อยู่ (STEP 25) — เส้นทางคงที่มาก่อน `/:addressId` (Express จับตามลำดับ)
userRouter.get('/me/addresses', listMyAddressesHandler);
userRouter.post('/me/addresses', createMyAddressHandler);
userRouter.patch('/me/addresses/:addressId/default', setMyDefaultAddressHandler);
userRouter.patch('/me/addresses/:addressId', updateMyAddressHandler);
userRouter.delete('/me/addresses/:addressId', deleteMyAddressHandler);
