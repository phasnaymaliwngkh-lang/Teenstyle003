import { z } from 'zod';

import { LOYALTY_TIERS, ROLE_NAMES, USER_STATUSES } from '../models/customer.model.ts';

/**
 * Validator ของข้อมูลลูกค้า (STEP 25)
 *
 * ⚠️ **สิ่งที่ลูกค้าแก้เองไม่ได้ ห้ามมีในสคีมาของฝั่งลูกค้าเลย**
 *    `email` · `role` · `status` · `points` · `loyaltyTier` · `totalSpent` · `image`
 *    Zod จะตัดฟิลด์ที่ไม่รู้จักทิ้ง จึงยัดมาทาง body ไม่ได้ (มีเทสต์ยืนยัน)
 *
 *    - `email` คือ **ตัวระบุตัวตนของบัญชี Google** เปลี่ยนแล้วจะผูกกับบัญชีเดิมไม่ได้
 *      และจะกลายเป็นช่องยึดบัญชีคนอื่น (ดูเหตุผลของ `allowDangerousEmailAccountLinking`)
 *    - `image` ยังรับไม่ได้เพราะจะกลายเป็นการรับ URL จากที่ไหนก็ได้
 *      (ปัญหาเดียวกับรูปในรีวิว STEP 23) — การอัปโหลดจริงเป็นงานของ STEP 47
 *
 * ⚠️ ข้อความ error ต้องใส่ที่ **ระดับชนิด** ด้วย ไม่ใช่แค่ใน `.min()`
 *    ไม่งั้นการไม่ส่งฟิลด์มาเลยจะได้ข้อความดิบ `expected string, received undefined`
 *    หลุดไปถึงหน้าจอผู้ใช้ (เจอจริงตอน STEP 15)
 */

const phone = z
  .string({ message: 'เบอร์โทรต้องเป็นข้อความ' })
  .trim()
  .min(9, 'เบอร์โทรสั้นเกินไป')
  .max(20, 'เบอร์โทรยาวเกินไป')
  .regex(/^[0-9+\-\s()]+$/, 'เบอร์โทรมีอักขระที่ไม่ถูกต้อง');

/**
 * วันเกิด — รับเฉพาะ `YYYY-MM-DD` และต้องเป็นวันที่ที่มีอยู่จริง
 *
 * ⚠️ ต้องแปลงเป็นเที่ยงคืน **UTC** เพราะคอลัมน์เป็น `@db.Date`
 *    ถ้าใช้ `new Date('2010-05-01')` ตรง ๆ แล้วผ่านโซนเวลา +07:00 วันที่จะเลื่อน
 */
const birthDate = z
  .string({ message: 'วันเกิดต้องอยู่ในรูปแบบ ปปปป-ดด-วว' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'วันเกิดต้องอยู่ในรูปแบบ ปปปป-ดด-วว')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    // กันวันที่ที่ JS เลื่อนให้เอง เช่น 2026-02-31 → 2026-03-03
    return parsed.toISOString().slice(0, 10) === value;
  }, 'ไม่มีวันที่นี้ในปฏิทิน')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).getTime() <= Date.now(), {
    message: 'วันเกิดต้องไม่เป็นวันในอนาคต',
  })
  .refine((value) => Number(value.slice(0, 4)) >= 1900, 'ปีเกิดต้องไม่ต่ำกว่า พ.ศ. 2443');

/**
 * แก้โปรไฟล์ของตัวเอง — ส่งมาเฉพาะฟิลด์ที่เปลี่ยน
 *
 * `null` = ล้างค่า · ไม่ส่งมาเลย = ไม่แก้ (แพตเทิร์นเดียวกับ PATCH สินค้า STEP 14)
 * ไม่ใช้ `.partial()` เพราะ `.partial()` ของ Zod 4 ไม่ลบ `.default()` (ดู CLAUDE.md)
 */
export const updateMyProfileSchema = z
  .object({
    name: z
      .string({ message: 'ชื่อต้องเป็นข้อความ' })
      .trim()
      .min(2, 'ชื่อสั้นเกินไป')
      .max(120, 'ชื่อยาวเกินไป')
      .optional(),
    phone: phone.nullable().optional(),
    birthDate: birthDate.nullable().optional(),
    allowPersonalization: z.boolean({ message: 'ค่านี้ต้องเป็น true หรือ false' }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'ไม่มีข้อมูลที่จะแก้ไข',
  });

/** ที่อยู่ในสมุดที่อยู่ — ใช้ตอนเพิ่มใหม่ (ทุกช่องที่จำเป็นต้องมี) */
export const createAddressSchema = z.object({
  label: z.string({ message: 'ชื่อเรียกต้องเป็นข้อความ' }).trim().max(60).nullish(),
  recipientName: z
    .string({ message: 'กรุณากรอกชื่อผู้รับ' })
    .trim()
    .min(2, 'กรุณากรอกชื่อผู้รับ')
    .max(120, 'ชื่อผู้รับยาวเกินไป'),
  phone,
  line1: z
    .string({ message: 'กรุณากรอกที่อยู่' })
    .trim()
    .min(5, 'กรุณากรอกที่อยู่')
    .max(200, 'ที่อยู่ยาวเกินไป'),
  line2: z.string({ message: 'ที่อยู่เพิ่มเติมต้องเป็นข้อความ' }).trim().max(200).nullish(),
  subDistrict: z
    .string({ message: 'กรุณากรอกแขวง/ตำบล' })
    .trim()
    .min(2, 'กรุณากรอกแขวง/ตำบล')
    .max(120),
  district: z
    .string({ message: 'กรุณากรอกเขต/อำเภอ' })
    .trim()
    .min(2, 'กรุณากรอกเขต/อำเภอ')
    .max(120),
  province: z.string({ message: 'กรุณากรอกจังหวัด' }).trim().min(2, 'กรุณากรอกจังหวัด').max(120),
  postalCode: z
    .string({ message: 'กรุณากรอกรหัสไปรษณีย์' })
    .trim()
    .regex(/^\d{5}$/, 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก'),
  /**
   * ตั้งเป็นที่อยู่เริ่มต้นทันที
   *
   * ⚠️ ไม่ใช่ `.default()` เพราะสคีมานี้ถูกนำไปทำเวอร์ชัน PATCH — ค่า default
   *    จะติดไปกับทุกคำขอแล้วแย่งค่าเริ่มต้นเงียบ ๆ (บั๊กที่เจอจริงตอน STEP 14)
   *    ไม่ส่งมา = service ตัดสินเอง (ที่อยู่แรกของบัญชีเป็นค่าเริ่มต้น)
   */
  isDefault: z.boolean({ message: 'ค่านี้ต้องเป็น true หรือ false' }).optional(),
});

/** แก้ที่อยู่ที่มีอยู่ — ส่งมาเฉพาะช่องที่เปลี่ยน */
export const updateAddressSchema = createAddressSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'ไม่มีข้อมูลที่จะแก้ไข' });

export const addressParamsSchema = z.object({
  addressId: z.string().uuid('addressId ต้องเป็น UUID'),
});

/* ───────────────────── ฝั่งพนักงาน ───────────────────── */

const CUSTOMER_SORTS = ['recent', 'oldest', 'name', 'lastLogin'] as const;

/**
 * query ของหน้ารายการลูกค้า
 *
 * ⚠️ **ไม่มีการเรียงตามยอดซื้อโดยเจตนา** — ยอดซื้อคิดจากตาราง `Order`
 *    การเรียงต้องทำก่อนแบ่งหน้า ไม่ใช่เรียงเฉพาะแถวในหน้าปัจจุบัน
 *    (บั๊กชนิดเดียวกับตัวกรอง "สต็อกต่ำ" ของ STEP 14 ข้อ 7)
 *    อันดับลูกค้าตามยอดซื้อเป็นงานของรายงาน STEP 26
 */
export const adminCustomerQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(ROLE_NAMES).optional(),
  tier: z.enum(LOYALTY_TIERS).optional(),
  sort: z.enum(CUSTOMER_SORTS).default('recent'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const customerParamsSchema = z.object({
  userId: z.string().uuid('userId ต้องเป็น UUID'),
});

/**
 * เปลี่ยนสถานะบัญชี
 *
 * `reason` บังคับกรอกเสมอ (ทั้งระงับและปลดระงับ) เพราะข้อความนี้ถูกบันทึกลง `AdminLog`
 * การตัดคนออกจากร้านหรือให้กลับเข้ามาต้องอธิบายย้อนหลังได้ว่าใครทำเพราะอะไร
 */
export const updateCustomerStatusSchema = z.object({
  status: z.enum(USER_STATUSES, { message: 'สถานะต้องเป็น ACTIVE, SUSPENDED หรือ BANNED' }),
  reason: z
    .string({ message: 'กรุณากรอกเหตุผล' })
    .trim()
    .min(3, 'เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร')
    .max(500, 'เหตุผลยาวเกินไป'),
});

/** เปลี่ยนบทบาท — ต้องมีสิทธิ์ `user:role:manage` และมีกฎกันยกระดับตัวเองใน service */
export const updateCustomerRoleSchema = z.object({
  role: z.enum(ROLE_NAMES, { message: 'บทบาทไม่ถูกต้อง' }),
  reason: z
    .string({ message: 'กรุณากรอกเหตุผล' })
    .trim()
    .min(3, 'เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร')
    .max(500, 'เหตุผลยาวเกินไป'),
});

export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;
export type UpdateCustomerStatusInput = z.infer<typeof updateCustomerStatusSchema>;
export type UpdateCustomerRoleInput = z.infer<typeof updateCustomerRoleSchema>;
