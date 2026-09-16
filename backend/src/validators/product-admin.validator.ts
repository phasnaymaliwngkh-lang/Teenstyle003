import { z } from 'zod';

import { allowedImageHostsText, isAllowedImageUrl } from '../config/media.ts';

import { gtinSchema } from './barcode.validator.ts';

/**
 * Validator ของการจัดการสินค้าในหลังบ้าน (STEP 14)
 *
 * ⚠️ ราคา/SKU/ชื่อ เป็นข้อมูลที่ **ร้านกรอกเอง** — ระบบไม่เดาและไม่เติมให้
 *    หน้าที่ของ validator คือกันค่าที่ผิดรูปหรือขัดกับกฎธุรกิจ
 * ⚠️ **ห้ามแก้จำนวนสต็อกผ่าน endpoint สินค้า** — สต็อกเดินผ่าน InventoryMovement เท่านั้น
 *    (ตอนสร้าง variant ให้ระบุ `initialStock` ได้ ซึ่งระบบจะบันทึกเป็นการรับเข้าจริง)
 */

const money = z.coerce
  .number({ message: 'ราคาต้องเป็นตัวเลข' })
  .min(0, 'ราคาติดลบไม่ได้')
  .max(1_000_000, 'ราคาสูงเกินกว่าที่ระบบรองรับ');

/**
 * ราคาที่ "ไม่มี" ได้ — `null` = ล้างค่าออก (เลิกโปรโมชัน / ใช้ราคาของสินค้าแม่)
 * ต่างจาก `undefined` ที่หมายถึง "ไม่แก้ฟิลด์นี้"
 */
const clearableMoney = money.nullable();

const slug = z
  .string()
  .trim()
  .min(2, 'slug สั้นเกินไป')
  .max(200)
  .regex(/^[a-z0-9-]+$/, 'slug ใช้ได้เฉพาะตัวอักษรเล็ก ตัวเลข และขีดกลาง');

const sku = z
  .string()
  .trim()
  .min(3, 'SKU สั้นเกินไป')
  .max(60)
  .regex(/^[A-Z0-9-]+$/, 'SKU ใช้ได้เฉพาะตัวพิมพ์ใหญ่ ตัวเลข และขีดกลาง');

const imageUrl = z
  .string()
  .trim()
  .url('ลิงก์รูปไม่ถูกต้อง')
  .max(1000)
  .refine(isAllowedImageUrl, {
    message: `รูปต้องเป็น https และมาจากโฮสต์ที่อนุญาตเท่านั้น (${allowedImageHostsText()})`,
  });

export const productImageSchema = z.object({
  url: imageUrl,
  alt: z.string().trim().min(2, 'กรุณาใส่คำอธิบายรูป (alt) เพื่อการเข้าถึง').max(200),
  isMain: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(99).default(0),
});

export const productVariantSchema = z.object({
  sku,
  /**
   * บาร์โค้ดสินค้า (GTIN) — `null` = ล้างค่า · ไม่ส่ง = ไม่แก้ (STEP 17)
   * ไม่บังคับ เพราะสินค้าที่ร้านผลิตเองอาจยังไม่มีเลข และ SKU พิมพ์เป็น Code 128 ได้อยู่แล้ว
   */
  barcode: gtinSchema.nullable().optional(),
  /** ถ้าไม่ส่ง = ใช้ราคาของสินค้าแม่ */
  price: clearableMoney.optional(),
  salePrice: clearableMoney.optional(),
  colorSlug: z.string().trim().max(120).optional(),
  sizeCode: z.string().trim().max(120).optional(),
  /** จำนวนรับเข้าครั้งแรก — ระบบบันทึกเป็น InventoryMovement (STOCK_IN) ให้ */
  initialStock: z.coerce.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
});

const productStatus = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const minimumStock = z.coerce.number().int().min(0).max(1000);
const tags = z.array(z.string().trim().min(1).max(60)).max(20);

/**
 * ฟิลด์ร่วมของสินค้า — **ห้ามใส่ `.default()` ที่นี่**
 *
 * ⚠️ `.partial()` ของ Zod 4 ห่อ `ZodOptional` ไว้**นอก** `ZodDefault` ค่า default จึงยังถูกเติม
 *    ให้ทุกคำขอ (ยืนยันแล้ว: `updateProductSchema.parse({})` คืน
 *    `{ status: 'DRAFT', minimumStock: 5, tags: [] }`)
 *    ถ้าปล่อยไว้ การแก้แค่ชื่อสินค้าจะ **ปิดการขายสินค้าและลบ tag ทิ้งเงียบ ๆ**
 *    → ค่า default ต้องอยู่ใน schema ของการ "สร้าง" เท่านั้น
 */
const productCore = z.object({
  name: z.string().trim().min(2, 'ชื่อสินค้าสั้นเกินไป').max(200),
  slug,
  sku,
  description: z.string().trim().min(10, 'คำอธิบายสั้นเกินไป').max(5000),
  shortDescription: z.string().trim().max(300).optional(),
  price: money,
  /** `null` = เลิกโปรโมชัน (กลับไปขายราคาปกติ) */
  salePrice: clearableMoney.optional(),
  categorySlug: z.string().trim().min(1, 'กรุณาเลือกหมวดหมู่').max(120),
  brandSlug: z.string().trim().max(120).optional(),
  status: productStatus,
  minimumStock,
  tags,
});

/** ราคาลดต้องต่ำกว่าราคาปกติ — กฎเดียวกับ CHECK `Product_salePrice_valid` ในฐานข้อมูล */
function salePriceBelowPrice<T extends { price: number; salePrice?: number | null | undefined }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.salePrice !== undefined && value.salePrice !== null && value.salePrice >= value.price) {
    ctx.addIssue({
      code: 'custom',
      path: ['salePrice'],
      message: 'ราคาลดต้องน้อยกว่าราคาปกติ',
    });
  }
}

export const createProductSchema = productCore
  .extend({
    // ค่าเริ่มต้นอยู่ที่นี่เท่านั้น (ดูเหตุผลที่ productCore)
    status: productStatus.default('DRAFT'),
    minimumStock: minimumStock.default(5),
    tags: tags.default([]),
    images: z.array(productImageSchema).max(10).default([]),
    variants: z
      .array(productVariantSchema)
      .min(1, 'ต้องมีตัวเลือกสินค้าอย่างน้อย 1 รายการ')
      .max(50),
  })
  .superRefine((value, ctx) => {
    salePriceBelowPrice(value, ctx);

    // SKU ของ variant ต้องไม่ซ้ำกันเองในคำขอเดียว
    const skus = value.variants.map((variant) => variant.sku);
    if (new Set(skus).size !== skus.length) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'SKU ของตัวเลือกซ้ำกัน' });
    }

    // คู่ (สี, ไซซ์) ต้องไม่ซ้ำ — ตรงกับ unique `[productId, colorId, sizeId]`
    const pairs = value.variants.map(
      (variant) => `${variant.colorSlug ?? '-'}|${variant.sizeCode ?? '-'}`,
    );
    if (new Set(pairs).size !== pairs.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'มีตัวเลือกที่สี/ไซซ์ซ้ำกัน',
      });
    }

    if (value.images.filter((image) => image.isMain).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'ตั้งรูปหลักได้เพียงรูปเดียว' });
    }
  });

/** แก้สินค้า — ส่งมาเฉพาะฟิลด์ที่ต้องการเปลี่ยน */
export const updateProductSchema = productCore
  .partial()
  .extend({ images: z.array(productImageSchema).max(10).optional() })
  .superRefine((value, ctx) => {
    if (value.price !== undefined) {
      salePriceBelowPrice({ price: value.price, salePrice: value.salePrice }, ctx);
    }

    if (value.images !== undefined && value.images.filter((image) => image.isMain).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'ตั้งรูปหลักได้เพียงรูปเดียว' });
    }

    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    }
  });

export const adminProductListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categorySlug: z.string().trim().max(120).optional(),
  /** true = แสดงเฉพาะสินค้าที่สต็อกถึงจุดเตือน */
  lowStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const productIdParamsSchema = z.object({
  productId: z.string().uuid('productId ต้องเป็น UUID'),
});

export const addVariantSchema = productVariantSchema;

/**
 * แก้ตัวเลือกสินค้า — แก้ได้แค่ราคา บาร์โค้ด และสถานะเปิด/ปิดขาย
 * **ไม่มีฟิลด์จำนวนสต็อกโดยเจตนา** ฟิลด์อย่าง `quantity` ที่ส่งมาจะถูกตัดทิ้ง
 * แล้วกลายเป็นคำขอว่าง → 422 (สต็อกเดินผ่าน InventoryMovement เท่านั้น)
 */
export const updateVariantSchema = z
  .object({
    /** `null` = ใช้ราคาของสินค้าแม่ */
    price: clearableMoney.optional(),
    /** `null` = เลิกโปรโมชันของตัวเลือกนี้ */
    salePrice: clearableMoney.optional(),
    /** `null` = ล้างบาร์โค้ด (เช่น กรอกผิด หรือจะออกเลขใหม่ของร้าน) */
    barcode: gtinSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'ไม่มีข้อมูลที่จะแก้ไข' });

export const variantIdParamsSchema = z.object({
  productId: z.string().uuid('productId ต้องเป็น UUID'),
  variantId: z.string().uuid('variantId ต้องเป็น UUID'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;
export type AddVariantInput = z.infer<typeof addVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
