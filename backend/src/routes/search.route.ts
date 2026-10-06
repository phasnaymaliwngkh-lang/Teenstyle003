import { Router } from 'express';

import { searchHandler, suggestHandler } from '../controllers/search.controller.ts';

/**
 * ค้นหา (STEP 45) — สาธารณะ อ่านอย่างเดียว
 *
 * ⚠️ `/suggest` ถูกยิงระหว่างพิมพ์จากเบราว์เซอร์ (หน่วงไว้ ~250ms) จึง **ไม่ใช้ `strictRateLimiter`**
 *    (20 ครั้ง/นาทีหมดในไม่กี่คำค้น) · ใช้ limit ปกติของ API ทั้งก้อนเหมือนหน้าร้านอื่น และไม่เรียก OpenAI
 */
export const searchRouter = Router();

searchRouter.get('/suggest', suggestHandler);
searchRouter.get('/', searchHandler);
