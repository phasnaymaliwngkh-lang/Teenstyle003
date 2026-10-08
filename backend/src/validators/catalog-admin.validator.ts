import { z } from 'zod';

import {
  CATALOG_SLUG_PATTERN,
  HEX_PATTERN,
  normalizeHex,
  SIZE_CODE_PATTERN,
} from '../models/catalog.model.ts';

/**
 * Validator ของหมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *
 * ⚠️ schema ของการ "แก้" ห้ามมี `.default()` — `.partial()` ของ Zod 4 ยังเติม default ให้
 *    (บทเรียน STEP 14: PATCH แค่ชื่อแล้วสถานะถูกรีเซ็ตเงียบ ๆ) จึงเขียน schema แก้แยกเอง
 * ⚠️ ข้อความ error ใส่ที่ระดับชนิดด้วย ไม่งั้นการไม่ส่งฟิลด์ได้ข้อความดิบของ Zod (บทเรียน STEP 15)
 */

const name = (label: string, max: number) =>
  z
    .string({ message: `กรุณาใส่ชื่อ${label}` })
    .trim()
    .min(1, `กรุณาใส่ชื่อ${label}`)
    .max(max, `ชื่อ${label}ยาวได้ไม่เกิน ${max} ตัวอักษร`);

const slug = z
  .string({ message: 'กรุณาใส่ slug' })
  .trim()
  .toLowerCase()
  .min(2, 'slug สั้นเกินไป (อย่างน้อย 2 ตัวอักษร)')
  .max(60, 'slug ยาวได้ไม่เกิน 60 ตัวอักษร')
  .regex(CATALOG_SLUG_PATTERN, 'slug ใช้ได้เฉพาะ a-z ตัวเลข และขีดกลางคั่นคำ เช่น oversize-tee');

const sizeCode = z
  .string({ message: 'กรุณาใส่รหัสไซซ์' })
  .trim()
  .toUpperCase()
  .min(1, 'กรุณาใส่รหัสไซซ์')
  .max(20, 'รหัสไซซ์ยาวได้ไม่เกิน 20 ตัวอักษร')
  .regex(SIZE_CODE_PATTERN, 'รหัสไซซ์ใช้ได้เฉพาะ A-Z ตัวเลข และขีดกลาง เช่น M, XL, EU36');

const hex = z
  .string({ message: 'กรุณาใส่ค่าสี' })
  .transform(normalizeHex)
  .refine((value) => HEX_PATTERN.test(value), 'ค่าสีต้องเป็นรูปแบบ #RRGGBB เช่น #7C3AED');

const description = z.string().trim().max(500, 'คำอธิบายยาวได้ไม่เกิน 500 ตัวอักษร');

const uuid = (label: string) =>
  z.string({ message: `กรุณาระบุ${label}` }).uuid(`${label}ไม่ถูกต้อง`);

function nonEmpty<T extends Record<string, unknown>>(value: T, ctx: z.RefinementCtx): void {
  if (Object.values(value).every((field) => field === undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: 'ไม่มีข้อมูลที่จะแก้ไข' });
  }
}

/* ─────────────────────────── หมวดหมู่ ─────────────────────────── */

export const createCategorySchema = z.object({
  name: name('หมวดหมู่', 80),
  slug,
  description: description.optional(),
  /** null/ไม่ส่ง = หมวดระดับบนสุด */
  parentId: uuid('หมวดแม่').nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = z
  .object({
    name: name('หมวดหมู่', 80).optional(),
    slug: slug.optional(),
    /** null = ล้างคำอธิบาย */
    description: description.nullable().optional(),
    /** null = ย้ายขึ้นเป็นหมวดระดับบนสุด */
    parentId: uuid('หมวดแม่').nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(nonEmpty);

/* ─────────────────────────── แบรนด์ ─────────────────────────── */

export const createBrandSchema = z.object({
  name: name('แบรนด์', 80),
  slug,
  description: description.optional(),
  isActive: z.boolean().default(true),
});

export const updateBrandSchema = z
  .object({
    name: name('แบรนด์', 80).optional(),
    slug: slug.optional(),
    description: description.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(nonEmpty);

/* ─────────────────────────── ไซซ์ ─────────────────────────── */

export const createSizeSchema = z.object({
  name: name('ไซซ์', 30),
  code: sizeCode,
  isActive: z.boolean().default(true),
});

export const updateSizeSchema = z
  .object({
    name: name('ไซซ์', 30).optional(),
    code: sizeCode.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(nonEmpty);

/* ─────────────────────────── สี ─────────────────────────── */

export const createColorSchema = z.object({
  name: name('สี', 40),
  slug,
  hex,
  isActive: z.boolean().default(true),
});

export const updateColorSchema = z
  .object({
    name: name('สี', 40).optional(),
    slug: slug.optional(),
    hex: hex.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(nonEmpty);

/* ─────────────────────────── ร่วม ─────────────────────────── */

export const catalogIdParamsSchema = z.object({ id: uuid('รหัสรายการ') });

/** ลำดับใหม่ของ **ทุกรายการ** ในกลุ่มนั้น (ไม่ครบ/ไม่ตรง = 409) */
export const reorderSchema = z.object({
  ids: z
    .array(uuid('รหัสรายการ'), { message: 'กรุณาส่งรายการที่จะเรียง' })
    .min(1, 'กรุณาส่งรายการที่จะเรียง')
    .max(200),
});

/** หมวดหมู่เรียงทีละกลุ่ม: หมวดบนสุด (parentId = null) หรือหมวดย่อยของหมวดแม่หนึ่ง */
export const reorderCategoriesSchema = reorderSchema.extend({
  parentId: uuid('หมวดแม่').nullable(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type CreateSizeInput = z.infer<typeof createSizeSchema>;
export type UpdateSizeInput = z.infer<typeof updateSizeSchema>;
export type CreateColorInput = z.infer<typeof createColorSchema>;
export type UpdateColorInput = z.infer<typeof updateColorSchema>;
