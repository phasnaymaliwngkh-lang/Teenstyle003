import { z } from 'zod';

import { addDays, daysBetween, GRANULARITIES, todayInZone } from '../models/analytics.model.ts';

import { fileFormatSchema } from './import-export.validator.ts';

/**
 * Validator ของรายงาน (STEP 26)
 *
 * ⚠️ `from` / `to` เป็น **วันที่ตามเวลาร้าน** (`YYYY-MM-DD`) ไม่ใช่ ISO timestamp
 *    เพราะรายงานพูดถึง "วันทำการ" ไม่ใช่ "ช่วงเวลาที่แม่นยำระดับวินาที"
 *    การแปลงเป็นเวลาจริงทำที่ `analytics.service.ts` ด้วย `zonedDayStart/End`
 *    (ดูเหตุผลเรื่องโซนเวลาใน `config/store.ts`)
 *
 * ⚠️ ข้อความ error ใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.regex()` (กฎที่เจอจริงตอน STEP 15)
 */

/** ช่วงเวลาที่ยาวเกินนี้ต้องแบ่งดูทีละช่วง — กันคิวรีที่กวาดทั้งตารางจนหน้าเว็บค้าง */
const MAX_RANGE_DAYS = 366;

const dateOnly = z
  .string({ message: 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    // กันวันที่ที่ JS เลื่อนให้เอง เช่น 2026-02-31 → 2026-03-03
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'ไม่มีวันที่นี้ในปฏิทิน');

/**
 * ช่วงเวลาของรายงาน
 *
 * ไม่ส่งมาเลย = 30 วันล่าสุด **นับตามเวลาร้าน** (ไม่ใช่ UTC)
 * ค่าเริ่มต้นคำนวณตอน parse จึงขยับตามวันจริงเสมอ ไม่ใช่ค่าที่ค้างตั้งแต่ตอน import โมดูล
 */
export const analyticsRangeSchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
  })
  .transform((value) => {
    const to = value.to ?? todayInZone();
    const from = value.from ?? addDays(to, -29);

    return { from, to, granularity: value.granularity };
  })
  .refine((value) => value.from <= value.to, {
    message: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด',
    path: ['from'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= MAX_RANGE_DAYS, {
    message: `ดูรายงานได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งช่วงให้สั้นลง`,
    path: ['to'],
  });

const PRODUCT_SORTS = ['revenue', 'quantity', 'orders'] as const;

export const productPerformanceQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    sort: z.enum(PRODUCT_SORTS).default('revenue'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .transform((value) => {
    const to = value.to ?? todayInZone();
    const from = value.from ?? addDays(to, -29);

    return { ...value, from, to };
  })
  .refine((value) => value.from <= value.to, {
    message: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด',
    path: ['from'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= MAX_RANGE_DAYS, {
    message: `ดูรายงานได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งช่วงให้สั้นลง`,
    path: ['to'],
  });

const CUSTOMER_SORTS = ['revenue', 'orders'] as const;

export const customerRankingQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    sort: z.enum(CUSTOMER_SORTS).default('revenue'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .transform((value) => {
    const to = value.to ?? todayInZone();
    const from = value.from ?? addDays(to, -29);

    return { ...value, from, to };
  })
  .refine((value) => value.from <= value.to, {
    message: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด',
    path: ['from'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= MAX_RANGE_DAYS, {
    message: `ดูรายงานได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งช่วงให้สั้นลง`,
    path: ['to'],
  });

/** ส่งออกรายงานเป็นไฟล์ — รูปแบบต้องตรงกับที่ STEP 18 รองรับ */
export const analyticsExportQuerySchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    granularity: z.enum(GRANULARITIES).default('day'),
    // ใช้ schema เดียวกับการส่งออกของ STEP 18 เพื่อให้ค่าที่รับได้ตรงกันทั้งระบบ
    format: fileFormatSchema.default('xlsx'),
  })
  .transform((value) => {
    const to = value.to ?? todayInZone();
    const from = value.from ?? addDays(to, -29);

    return { ...value, from, to };
  })
  .refine((value) => value.from <= value.to, {
    message: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด',
    path: ['from'],
  })
  .refine((value) => daysBetween(value.from, value.to) <= MAX_RANGE_DAYS, {
    message: `ดูรายงานได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS} วัน — แบ่งช่วงให้สั้นลง`,
    path: ['to'],
  });

export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeSchema>;
export type ProductPerformanceQuery = z.infer<typeof productPerformanceQuerySchema>;
export type CustomerRankingQuery = z.infer<typeof customerRankingQuerySchema>;
export type AnalyticsExportQuery = z.infer<typeof analyticsExportQuerySchema>;
