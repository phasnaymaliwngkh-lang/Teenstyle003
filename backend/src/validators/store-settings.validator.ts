import { z } from 'zod';

import {
  CUTOFF_TIME_PATTERN,
  PHONE_PATTERN,
  SOCIAL_PLATFORMS,
  STORE_SETTING_LIMITS,
  socialUrlProblem,
  type SocialPlatform,
} from '../models/store-settings.model.ts';

import { MONEY_IN_TEXT } from './shipping.validator.ts';

/**
 * Validator ของการตั้งค่าร้าน (STEP 49)
 *
 * ⚠️ ไม่มี `.default()` — ไม่ส่งช่องไหนมา = ไม่แก้ช่องนั้น (บทเรียน Zod 4 ของ STEP 14)
 * ⚠️ ช่องช่องทางติดต่อ/โซเชียลส่ง `null` = **ร้านไม่มีช่องทางนั้น** (หายจากทุกหน้า)
 *    สตริงว่างถูกปฏิเสธ — กันฟอร์มที่ลืมแปลง "" เป็น null แล้วได้ลิงก์ว่างโผล่ใน footer
 */

const LIMIT = STORE_SETTING_LIMITS;

const text = (label: string, limits: { min: number; max: number }) =>
  z
    .string({ message: `กรุณากรอก${label}` })
    .trim()
    .min(limits.min, `${label}สั้นเกินไป`)
    .max(limits.max, `${label}ยาวเกินไป (ไม่เกิน ${limits.max} ตัวอักษร)`);

const socialUrl = (platform: SocialPlatform) =>
  z
    .string({ message: `ลิงก์ ${platform.label} ต้องเป็นข้อความ` })
    .trim()
    .max(300, `ลิงก์ ${platform.label} ยาวเกินไป`)
    .superRefine((value, ctx) => {
      const problem = socialUrlProblem(platform, value);
      if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
    })
    .nullable()
    .optional();

const platform = (field: SocialPlatform['field']) =>
  SOCIAL_PLATFORMS.find((candidate) => candidate.field === field)!;

export const updateStoreSettingsSchema = z
  .object({
    /**
     * ⚠️ ห้ามมีจำนวนเงิน — คำอธิบายแสดงในทุกหน้า ถ้าพิมพ์ "ส่งฟรีเมื่อครบ 500 บาท" ไว้
     *    ตัวเลขจะค้างค่าเก่าทันทีที่แก้ค่าส่ง (กฎเดียวกับคำอธิบายวิธีจัดส่งของ STEP 44)
     */
    description: text('คำอธิบายร้าน', LIMIT.description)
      .refine((value) => !MONEY_IN_TEXT.test(value), {
        message: 'คำอธิบายร้านห้ามมีจำนวนเงิน — ค่าส่งและโปรโมชันแสดงจากระบบของมันเอง',
      })
      .optional(),
    contactEmail: z
      .string({ message: 'อีเมลต้องเป็นข้อความ' })
      .trim()
      .max(120, 'อีเมลยาวเกินไป')
      .pipe(z.email({ message: 'อีเมลไม่ถูกต้อง' }))
      .nullable()
      .optional(),
    contactPhone: z
      .string({ message: 'เบอร์โทรต้องเป็นข้อความ' })
      .trim()
      .regex(PHONE_PATTERN, 'เบอร์โทรใช้ได้เฉพาะตัวเลข ช่องว่าง ขีด และ + นำหน้า (9–15 หลัก)')
      .nullable()
      .optional(),
    instagramUrl: socialUrl(platform('instagramUrl')),
    tiktokUrl: socialUrl(platform('tiktokUrl')),
    facebookUrl: socialUrl(platform('facebookUrl')),
    lineUrl: socialUrl(platform('lineUrl')),
    agentHours: text('เวลาทำการของเจ้าหน้าที่', LIMIT.agentHours).optional(),
    shippingDays: text('วันที่ส่งของ', LIMIT.shippingDays).optional(),
    cutoffTime: z
      .string({ message: 'กรุณากรอกเวลาตัดรอบ' })
      .trim()
      .regex(CUTOFF_TIME_PATTERN, 'เวลาตัดรอบต้องเป็นรูปแบบ 24 ชั่วโมง เช่น 12:00 หรือ 09:30')
      .optional(),
    returnWindowDays: z
      .number({ message: 'จำนวนวันที่คืนได้ต้องเป็นตัวเลข' })
      .int('จำนวนวันที่คืนได้ต้องเป็นจำนวนเต็ม')
      .min(LIMIT.returnWindowDays.min, `คืนได้อย่างน้อย ${LIMIT.returnWindowDays.min} วัน`)
      .max(LIMIT.returnWindowDays.max, `คืนได้ไม่เกิน ${LIMIT.returnWindowDays.max} วัน`)
      .optional(),
    codMaxTotal: z
      .number({ message: 'ยอดสูงสุดของ COD ต้องเป็นตัวเลข' })
      .min(LIMIT.codMaxTotal.min, 'ยอดสูงสุดของ COD ต้องมากกว่า 0')
      .max(
        LIMIT.codMaxTotal.max,
        `ยอดสูงสุดของ COD ไม่เกิน ${LIMIT.codMaxTotal.max.toLocaleString('th-TH')} บาท`,
      )
      // เทียบในหน่วยสตางค์ — 0.1 + 0.2 ของ JS ไม่ได้ 0.3 พอดี (บทเรียน STEP 42)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
        message: 'ยอดสูงสุดของ COD มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง',
      })
      .optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'ไม่มีข้อมูลที่จะแก้',
  });

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
