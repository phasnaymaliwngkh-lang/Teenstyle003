import { env } from './env.ts';

/**
 * ช่องทางแจ้งเตือน (STEP 16)
 *
 * ⚠️ **ห้ามสร้างแถวแจ้งเตือนของช่องทางที่ส่งไม่ได้จริง** — ถ้า SMTP ยังไม่ได้ตั้งค่า
 *    ระบบต้องไม่สร้าง Notification ช่องทาง EMAIL ไว้ให้ดูเหมือนว่า "ส่งแล้ว"
 *    (แพตเทิร์นเดียวกับช่องทางชำระเงินใน [payment.ts](./payment.ts))
 *
 * สถานะจริงตอนนี้: IN_APP ใช้ได้ · EMAIL ยังไม่ได้ตั้งค่า SMTP
 * การส่งอีเมลจริง (nodemailer + template + retry) เป็นงานของ STEP 50
 */

/** ต้องมี host และผู้ส่ง จึงจะถือว่าตั้งค่าอีเมลครบพอจะส่งได้ */
export const isEmailConfigured = env.SMTP_HOST !== undefined && env.MAIL_FROM !== undefined;

export interface NotificationChannelInfo {
  code: 'IN_APP' | 'EMAIL' | 'PUSH';
  name: string;
  available: boolean;
  /** เหตุผลที่ยังใช้ไม่ได้ (บอกตรง ๆ ไม่ปิดบัง) */
  unavailableReason: string | null;
}

export function notificationChannels(): NotificationChannelInfo[] {
  return [
    {
      code: 'IN_APP',
      name: 'แจ้งเตือนในระบบหลังบ้าน',
      available: true,
      unavailableReason: null,
    },
    {
      code: 'EMAIL',
      name: 'อีเมล',
      available: isEmailConfigured,
      unavailableReason: isEmailConfigured
        ? // ตั้งค่า SMTP แล้ว แต่ยังไม่มีตัวส่งจริง — ต้องบอกตามจริง ห้ามแกล้งส่ง
          'ตั้งค่า SMTP แล้ว แต่ระบบส่งอีเมลจริงจะเริ่มใช้ใน STEP 50'
        : 'ยังไม่ได้ตั้งค่า SMTP_HOST และ MAIL_FROM ใน .env',
    },
    {
      code: 'PUSH',
      name: 'Push notification',
      available: false,
      unavailableReason: 'ยังไม่รองรับ — จะทำในภายหลัง',
    },
  ];
}
