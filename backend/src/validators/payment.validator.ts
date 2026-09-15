import { z } from 'zod';

import { PAYMENT_PROVIDERS } from '../config/payment.ts';

/**
 * Validator ของการชำระเงิน (STEP 11)
 *
 * ⚠️ client บอกได้แค่ "จะจ่ายด้วยวิธีไหน" — **ยอดเงินอ่านจากออเดอร์ในฐานข้อมูลเท่านั้น**
 *    และห้ามมีฟิลด์ใดที่รับข้อมูลบัตร (เลขบัตร/CVV/วันหมดอายุ) เข้ามาที่ระบบเรา
 */
export const startPaymentSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS, { message: 'ช่องทางชำระเงินไม่ถูกต้อง' }),
});

export type StartPaymentInput = z.infer<typeof startPaymentSchema>;
