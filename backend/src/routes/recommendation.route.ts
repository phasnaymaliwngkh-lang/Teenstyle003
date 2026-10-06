import { Router } from 'express';

import { forYouHandler } from '../controllers/recommendation.controller.ts';
import { attachUser } from '../middlewares/authenticate.ts';

/**
 * การแนะนำสินค้าเฉพาะบุคคล (STEP 46) — ล็อกอินถ้ามี
 * ไม่ล็อกอิน / ปิดการแนะนำ / ยังไม่มีประวัติ → ได้รายการยอดนิยมพร้อมบอกเหตุผล (ไม่ใช่ 401)
 */
export const recommendationRouter = Router();

recommendationRouter.get('/for-you', attachUser, forYouHandler);
