import { z } from 'zod';

/**
 * Validator สำหรับระบบนำเข้าและส่งออกข้อมูล (STEP 18)
 *
 * ⚠️ กฎของ Zod ในโปรเจกต์นี้
 *   1. ข้อความ error ต้องระบุที่ระดับชนิดด้วย ({ message: '...' }) ไม่ใช่แค่ใน .min()
 *   2. schema ที่จะเอาไป partial() ห้ามมี .default()
 */

export const fileFormatSchema = z.enum(['csv', 'xlsx'], {
  message: 'รูปแบบไฟล์ต้องเป็น csv หรือ xlsx เท่านั้น',
});

export type FileFormat = z.infer<typeof fileFormatSchema>;

/* ─────────────────────────── ส่งออกข้อมูล ─────────────────────────── */

export const exportProductsQuerySchema = z.object({
  format: fileFormatSchema.default('xlsx'),
  status: z.enum(['ALL', 'DRAFT', 'ACTIVE', 'ARCHIVED']).default('ALL'),
  categoryId: z.string().uuid({ message: 'categoryId ต้องเป็น UUID' }).optional(),
  brandId: z.string().uuid({ message: 'brandId ต้องเป็น UUID' }).optional(),
});

export type ExportProductsQuery = z.infer<typeof exportProductsQuerySchema>;

export const exportInventoryQuerySchema = z.object({
  format: fileFormatSchema.default('xlsx'),
  stockStatus: z.enum(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).default('ALL'),
  location: z.string().optional(),
});

export type ExportInventoryQuery = z.infer<typeof exportInventoryQuerySchema>;

export const exportOrdersQuerySchema = z.object({
  format: fileFormatSchema.default('xlsx'),
  status: z
    .enum([
      'ALL',
      'PENDING_PAYMENT',
      'PAID',
      'PROCESSING',
      'PACKING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ])
    .default('ALL'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type ExportOrdersQuery = z.infer<typeof exportOrdersQuerySchema>;

export const templateQuerySchema = z.object({
  format: fileFormatSchema.default('xlsx'),
});

export type TemplateQuery = z.infer<typeof templateQuerySchema>;

export const importQuerySchema = z.object({
  dryRun: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .default(false),
});

export type ImportQuery = z.infer<typeof importQuerySchema>;

/* ─────────────────────────── แถวข้อมูลนำเข้า ─────────────────────────── */

export const productImportRowSchema = z
  .object({
    productName: z
      .string({ message: 'ต้องระบุชื่อสินค้า' })
      .trim()
      .min(2, 'ชื่อสินค้าต้องมีอย่างน้อย 2 ตัวอักษร')
      .max(120, 'ชื่อสินค้าต้องไม่เกิน 120 ตัวอักษร'),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]+$/, 'Slug ต้องเป็นตัวพิมพ์เล็ก ตัวเลข และขีดกลางเท่านั้น')
      .optional()
      .or(z.literal('')),
    sku: z
      .string({ message: 'ต้องระบุ SKU สินค้า' })
      .trim()
      .min(2, 'SKU สินค้าต้องมีอย่างน้อย 2 ตัวอักษร')
      .max(64, 'SKU สินค้าต้องไม่เกิน 64 ตัวอักษร'),
    category: z
      .string({ message: 'ต้องระบุหมวดหมู่' })
      .trim()
      .min(1, 'ต้องระบุชื่อหรือ slug หมวดหมู่'),
    brand: z.string().trim().optional().or(z.literal('')),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('ACTIVE'),
    price: z
      .number({ message: 'ราคาต้องเป็นตัวเลข' })
      .positive('ราคาต้องมากกว่า 0')
      .max(10_000_000, 'ราคาต้องไม่เกิน 10,000,000 บาท'),
    salePrice: z
      .number({ message: 'ราคาลดต้องเป็นตัวเลข' })
      .positive('ราคาลดต้องมากกว่า 0')
      .optional()
      .nullable(),
    minimumStock: z
      .number({ message: 'จุดเตือนสต็อกต่ำต้องเป็นตัวเลข' })
      .int('จุดเตือนสต็อกต่ำต้องเป็นจำนวนเต็ม')
      .min(0, 'จุดเตือนสต็อกต่ำต้องไม่ติดลบ')
      .default(5),
    variantSku: z
      .string({ message: 'ต้องระบุ SKU ตัวเลือกสินค้า' })
      .trim()
      .min(2, 'SKU ตัวเลือกต้องมีอย่างน้อย 2 ตัวอักษร')
      .max(64, 'SKU ตัวเลือกต้องไม่เกิน 64 ตัวอักษร'),
    color: z.string().trim().optional().or(z.literal('')),
    size: z.string().trim().optional().or(z.literal('')),
    barcode: z
      .string()
      .trim()
      .regex(/^\d{8}$|^\d{12,14}$/, 'บาร์โค้ดต้องเป็นตัวเลข 8, 12, 13 หรือ 14 หลัก')
      .optional()
      .or(z.literal('')),
    initialStock: z
      .number({ message: 'สต็อกเริ่มต้นต้องเป็นตัวเลข' })
      .int('สต็อกเริ่มต้นต้องเป็นจำนวนเต็ม')
      .min(0, 'สต็อกเริ่มต้นต้องไม่ติดลบ')
      .default(0),
    description: z.string().trim().optional().or(z.literal('')),
  })
  .refine(
    (row) => {
      if (row.salePrice !== undefined && row.salePrice !== null) {
        return row.salePrice < row.price;
      }
      return true;
    },
    { message: 'ราคาลด (salePrice) ต้องน้อยกว่าราคาปกติ (price)', path: ['salePrice'] },
  );

export type ProductImportRow = z.infer<typeof productImportRowSchema>;

export const inventoryImportRowSchema = z.object({
  sku: z
    .string({ message: 'ต้องระบุ SKU หรือบาร์โค้ด' })
    .trim()
    .min(1, 'ต้องระบุ SKU หรือบาร์โค้ด'),
  type: z.enum(['ADJUSTMENT', 'STOCK_IN', 'STOCK_OUT'], {
    message: 'ประเภทต้องเป็น ADJUSTMENT (นับยอดจริง), STOCK_IN (รับเข้า) หรือ STOCK_OUT (ตัดออก)',
  }),
  quantity: z
    .number({ message: 'จำนวนต้องเป็นตัวเลข' })
    .int('จำนวนต้องเป็นจำนวนเต็ม')
    .min(0, 'จำนวนต้องไม่ติดลบ'),
  reason: z
    .string({ message: 'ต้องระบุเหตุผลการปรับสต็อก' })
    .trim()
    .min(3, 'เหตุผลต้องมีความยาวอย่างน้อย 3 ตัวอักษร')
    .max(255, 'เหตุผลต้องไม่เกิน 255 ตัวอักษร'),
});

export type InventoryImportRow = z.infer<typeof inventoryImportRowSchema>;

