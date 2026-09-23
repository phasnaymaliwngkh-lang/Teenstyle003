import { Router } from 'express';

import {
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
  unreadCountHandler,
} from '../controllers/notification.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของการแจ้งเตือน (STEP 24)
 *
 * - **ต้องล็อกอินทุกเส้นทาง** — การแจ้งเตือนผูกกับบัญชี และ service กรอง `userId` เสมอ
 *   ไม่ต้องมีสิทธิ์พิเศษเพิ่ม (แพตเทิร์นเดียวกับ `/api/orders` ที่เป็นข้อมูลของตัวเอง):
 *   ขอบเขตความปลอดภัยคือ "เป็นเจ้าของแถวไหม" ไม่ใช่ "มีสิทธิ์อะไร"
 * - `verifyOrigin` ทุกเส้นทาง กัน CSRF (production ใช้ `SameSite=None` จึงต้องตรวจ Origin เอง)
 * - **ไม่มี endpoint สร้าง/แก้เนื้อหา** — เนื้อหาทุกบรรทัดเกิดจากเหตุการณ์จริงที่ฝั่ง server เท่านั้น
 */
export const notificationRouter = Router();

notificationRouter.use(verifyOrigin, requireAuth);

// path คงที่ต้องมาก่อน `/:notificationId` (Express จับตามลำดับ)
notificationRouter.get('/unread-count', unreadCountHandler);
notificationRouter.patch('/read-all', markAllReadHandler);

notificationRouter.get('/', listNotificationsHandler);
notificationRouter.patch('/:notificationId/read', markReadHandler);
