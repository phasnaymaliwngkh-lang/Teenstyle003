import { env } from './env.ts';

/**
 * ช่องทางชำระเงิน (STEP 11)
 *
 * ⚠️ **ห้ามทำหน้าชำระเงินปลอม** — ช่องทางที่ยังตั้งค่าไม่ครบต้องถูกปิด
 *    และบอกผู้ใช้ตรง ๆ ว่ายังใช้ไม่ได้เพราะอะไร (แพตเทิร์นเดียวกับ Google OAuth ใน STEP 3)
 *
 * ⚠️ **ห้ามเก็บ raw card data** — การกรอกเลขบัตรเกิดบนหน้าโฮสต์ของ Stripe เท่านั้น
 *    ระบบเราเก็บได้แค่ id/สถานะที่ provider ส่งกลับมา
 */

/** ต้องมีทั้ง secret key และ webhook secret จึงจะเปิดใช้ Stripe ได้จริง */
export const isStripeConfigured =
  env.STRIPE_SECRET_KEY !== undefined && env.STRIPE_WEBHOOK_SECRET !== undefined;

/** เปิดใช้เฉพาะการตรวจลายเซ็น webhook (ใช้ตอนทดสอบ/ตั้งค่าไม่ครบ) */
export const isStripeWebhookConfigured = env.STRIPE_WEBHOOK_SECRET !== undefined;

export const PAYMENT_PROVIDERS = ['COD', 'STRIPE'] as const;

export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentMethodInfo {
  code: PaymentProviderCode;
  name: string;
  description: string;
  /** ใช้ได้จริงตอนนี้ไหม */
  available: boolean;
  /** เหตุผลที่ยังใช้ไม่ได้ (บอกตรง ๆ ไม่ปิดบัง) */
  unavailableReason: string | null;
  /** ชำระเงินออนไลน์ทันทีไหม (false = เก็บเงินภายหลัง) */
  online: boolean;
}

/** ยอดสูงสุดที่ยอมให้เก็บเงินปลายทาง (กันความเสียหายจากออเดอร์ปลอมยอดสูง) */
export const COD_MAX_TOTAL = 5000;

export function paymentMethods(orderTotal: number): PaymentMethodInfo[] {
  const codTooExpensive = orderTotal > COD_MAX_TOTAL;

  return [
    {
      code: 'STRIPE',
      name: 'บัตรเครดิต/เดบิต หรือ PromptPay',
      description: 'ชำระผ่านหน้าชำระเงินของ Stripe — ข้อมูลบัตรไม่ผ่านเซิร์ฟเวอร์ของเรา',
      available: isStripeConfigured,
      unavailableReason: isStripeConfigured
        ? null
        : 'ยังไม่ได้ตั้งค่า STRIPE_SECRET_KEY และ STRIPE_WEBHOOK_SECRET ใน .env (ดู docs/07-payment-setup.md)',
      online: true,
    },
    {
      code: 'COD',
      name: 'เก็บเงินปลายทาง (COD)',
      description: 'จ่ายเงินสดกับพนักงานส่งของตอนได้รับสินค้า',
      available: !codTooExpensive,
      unavailableReason: codTooExpensive
        ? `ยอดเกิน ${COD_MAX_TOTAL.toLocaleString('th-TH')} บาท — กรุณาชำระเงินออนไลน์`
        : null,
      online: false,
    },
  ];
}

/** เวลาที่คำสั่งซื้อจะหมดอายุถ้าไม่ชำระเงิน */
export function paymentDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + env.PAYMENT_WINDOW_MINUTES * 60 * 1000);
}
