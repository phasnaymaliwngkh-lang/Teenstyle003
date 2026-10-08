import { Router } from 'express';

import { getStoreInfoHandler } from '../controllers/store-settings.controller.ts';

/**
 * ข้อมูลร้าน (STEP 49) — สาธารณะ ไม่ต้องล็อกอิน
 *
 * คำอธิบาย ช่องทางติดต่อ โซเชียล เวลาทำการ และตัวเลขนโยบาย (คืนได้กี่วัน · COD สูงสุด)
 * ที่ร้านแก้ได้ที่ /admin/settings · อ่านอย่างเดียว · ช่องที่ร้านไม่มีจะไม่ถูกส่งมาเป็นค่าสมมติ
 */
export const storeRouter = Router();

storeRouter.get('/', getStoreInfoHandler);
