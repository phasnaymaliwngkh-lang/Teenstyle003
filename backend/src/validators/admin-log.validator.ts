import { z } from 'zod';

import { ACTION_GROUPS, TARGET_TYPES } from '../models/admin-log.model.ts';
import { addDays, daysBetween, todayInZone } from '../models/analytics.model.ts';

import { fileFormatSchema } from './import-export.validator.ts';

/**
 * Validator ของ Audit log (STEP 27)
 *
 * ⚠️ ช่วงวันที่เป็น **วันตามเวลาร้าน** (`YYYY-MM-DD`) และแปลงเป็นเวลาจริงที่ service
 *    ด้วย `zonedDayStart/End` เหมือนรายงานยอดขาย — ห้ามตัดวันแบบ UTC
 *    (ดูเหตุผลเต็มที่หัวข้อโซนเวลาใน CLAUDE.md)
 */

/** ประวัติย้อนหลังดูได้ทีละไม่เกินหนึ่งปี — กันคิวรีที่กวาดทั้งตาราง */
const MAX_RANGE_DAYS = 366;

const dateOnly = z
  .string({ message: 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'ไม่มีวันที่นี้ในปฏิทิน');

const baseFilters = {
  /** ค้นในชื่อ/อีเมลผู้ทำรายการ และรหัสของสิ่งที่ถูกแก้ */
  q: z.string().trim().max(120).optional(),
  group: z.enum(ACTION_GROUPS).optional(),
  action: z.string().trim().max(80).optional(),
  targetType: z.enum(TARGET_TYPES).optional(),
  targetId: z.string().trim().max(80).optional(),
  userId: z.string().uuid('userId ต้องเป็น UUID').optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
};

/** ไม่ส่งช่วงมาเลย = 30 วันล่าสุดตามเวลาร้าน */
function withDefaultRange<T extends { from?: string | undefined; to?: string | undefined }>(
  value: T,
): T & { from: string; to: string } {
  const to = value.to ?? todayInZone();
  const from = value.from ?? addDays(to, -29);

  return { ...value, from, to };
}

const rangeChecks = [
  {
    check: (value: { from: string; to: string }) => value.from <= value.to,
    message: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด',
    path: ['from'] as const,
  },
  {
    check: (value: { from: string; to: string }) =>
      daysBetween(value.from, value.to) <= MAX_RANGE_DAYS,
    message: `ดูประวัติได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งช่วงให้สั้นลง`,
    path: ['to'] as const,
  },
];

export const adminLogQuerySchema = z
  .object({
    ...baseFilters,
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .transform(withDefaultRange)
  .refine(rangeChecks[0]!.check, { message: rangeChecks[0]!.message, path: ['from'] })
  .refine(rangeChecks[1]!.check, { message: rangeChecks[1]!.message, path: ['to'] });

/** ตัวเลือกของตัวกรอง — ใช้ช่วงเดียวกับรายการ เพื่อให้ตัวเลือกตรงกับสิ่งที่กรองได้จริง */
export const adminLogFilterQuerySchema = z
  .object({ from: dateOnly.optional(), to: dateOnly.optional() })
  .transform(withDefaultRange)
  .refine(rangeChecks[0]!.check, { message: rangeChecks[0]!.message, path: ['from'] })
  .refine(rangeChecks[1]!.check, { message: rangeChecks[1]!.message, path: ['to'] });

export const adminLogExportQuerySchema = z
  .object({ ...baseFilters, format: fileFormatSchema.default('xlsx') })
  .transform(withDefaultRange)
  .refine(rangeChecks[0]!.check, { message: rangeChecks[0]!.message, path: ['from'] })
  .refine(rangeChecks[1]!.check, { message: rangeChecks[1]!.message, path: ['to'] });

/** ประวัติของสิ่งใดสิ่งหนึ่ง — ไม่จำกัดช่วงเวลา เพราะเป็นการดูของชิ้นเดียว */
export const targetHistoryParamsSchema = z.object({
  targetType: z.enum(TARGET_TYPES, { message: 'ชนิดของสิ่งที่ค้นไม่ถูกต้อง' }),
  targetId: z.string().trim().min(1).max(80),
});

export type AdminLogQuery = z.infer<typeof adminLogQuerySchema>;
export type AdminLogFilterQuery = z.infer<typeof adminLogFilterQuerySchema>;
export type AdminLogExportQuery = z.infer<typeof adminLogExportQuerySchema>;
