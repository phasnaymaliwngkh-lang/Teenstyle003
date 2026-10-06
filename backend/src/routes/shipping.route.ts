import { Router } from 'express';

import { getShippingOptionsHandler } from '../controllers/shipping.controller.ts';

/**
 * วิธีจัดส่งที่เปิดใช้ (STEP 44) — สาธารณะ ไม่ต้องล็อกอิน
 *
 * ค่าส่งเป็นนโยบายของร้านที่ลูกค้าต้องรู้ก่อนตัดสินใจซื้อ (หน้าแรกอ่านยอดส่งฟรีจากที่นี่)
 * อ่านอย่างเดียว · ตัวเลขชุดเดียวกับที่หน้า checkout คิดเงิน (ตาราง ShippingRate)
 */
export const shippingRouter = Router();

shippingRouter.get('/options', getShippingOptionsHandler);
