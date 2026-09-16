import { isValidGtin, normalizeGtin } from '@teenstyle/database';
import { z } from 'zod';

/**
 * Validator ของระบบบาร์โค้ด / QR (STEP 17)
 *
 * ⚠️ ข้อความ error ต้องใส่ที่ **ระดับชนิด** ด้วย ไม่ใช่แค่ใน `.min()`
 *    (บทเรียนจาก STEP 15: ถ้าไม่ส่งฟิลด์มาเลย Zod จะตอบ `expected string, received undefined`
 *     ซึ่งเป็นข้อความดิบภาษาอังกฤษที่หลุดไปถึงหน้าจอผู้ใช้)
 */

/**
 * บาร์โค้ดสินค้า (GTIN) ที่ร้านกรอกเอง
 *
 * ยอมให้พิมพ์ช่องว่าง/ขีดกลางคั่นได้ (คนอ่านเลขจากกล่องมักพิมพ์แบบนั้น) แล้วตัดออกให้
 * แต่ **ต้องผ่าน check digit** เสมอ — เลขที่ไม่ผ่านคือเลขที่เครื่องสแกนอ่านไม่ติด
 * การรับไว้เท่ากับปล่อยให้ร้านพิมพ์ป้ายที่ใช้งานไม่ได้
 */
export const gtinSchema = z
  .string({ message: 'บาร์โค้ดต้องเป็นข้อความ' })
  .trim()
  .max(24, 'บาร์โค้ดยาวเกินมาตรฐาน')
  .transform(normalizeGtin)
  .refine(isValidGtin, {
    message:
      'บาร์โค้ดต้องเป็นตัวเลข 8, 12 หรือ 13 หลัก และหลักตรวจสอบ (check digit) ต้องถูกต้อง — ลองตรวจเลขที่พิมพ์อีกครั้ง',
  });

/** GET /api/admin/barcodes/lookup?code= */
export const barcodeLookupQuerySchema = z.object({
  code: z
    .string({ message: 'กรุณาระบุบาร์โค้ดหรือ SKU ที่จะค้นหา' })
    .trim()
    .min(3, 'โค้ดที่ค้นหาสั้นเกินไป')
    .max(64, 'โค้ดที่ค้นหายาวเกินไป'),
});

/**
 * GET /api/admin/barcodes/labels?productId=…  หรือ  ?variantId=…&variantId=…
 *
 * **เป็น GET เพราะเป็นการอ่านข้อมูลมาพิมพ์ ไม่ได้เปลี่ยนอะไร** และที่สำคัญกว่านั้น
 * หน้า `/admin/barcodes/labels` เป็น Server Component ที่เรียก backend แบบ server-to-server
 * ซึ่งไม่มี header `Origin` ติดไปด้วย — `verifyOrigin` จะบล็อก POST แบบนั้นตอน production
 *
 * client บอกได้แค่ว่า **จะพิมพ์ของตัวไหน** และ **อยากได้สัญลักษณ์แบบไหน**
 * ข้อความบนป้ายทุกตัวอักษร (ชื่อสินค้า ราคา SKU บาร์โค้ด) อ่านจากฐานข้อมูลที่ server
 */
export const labelRequestSchema = z
  .object({
    /** พิมพ์ทุกตัวเลือกของสินค้าหนึ่งตัว */
    productId: z.string().uuid('productId ต้องเป็น UUID').optional(),
    /**
     * หรือระบุตัวเลือกเป็นรายตัว — `?variantId=a&variantId=b`
     * (Express ให้ค่าเป็น string เดี่ยวเมื่อส่งมาอันเดียว จึงต้องรับทั้งสองรูป)
     */
    variantIds: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .pipe(
        z
          .array(z.string().uuid('variantId ต้องเป็น UUID'))
          .min(1, 'ต้องเลือกอย่างน้อย 1 ตัวเลือก')
          .max(50, 'เลือกได้ไม่เกิน 50 ตัวเลือกต่อครั้ง'),
      )
      .optional(),
    /**
     * `auto` = ใช้บาร์โค้ดสินค้าถ้ามี ไม่มีก็ใช้ Code 128 ของ SKU
     * `qrcode` = QR ของลิงก์หน้าสินค้า (สำหรับป้ายบนชั้นวางให้ลูกค้าสแกน)
     */
    symbology: z.enum(['auto', 'code128', 'qrcode']).default('auto'),
    /** จำนวนป้ายต่อหนึ่งตัวเลือก */
    copies: z.coerce
      .number({ message: 'จำนวนป้ายต้องเป็นตัวเลข' })
      .int('จำนวนป้ายต้องเป็นจำนวนเต็ม')
      .min(1, 'ต้องพิมพ์อย่างน้อย 1 ป้าย')
      .max(50, 'พิมพ์ได้ไม่เกิน 50 ป้ายต่อตัวเลือก')
      .default(1),
  })
  .superRefine((value, ctx) => {
    const hasProduct = value.productId !== undefined;
    const hasVariants = value.variantIds !== undefined;

    if (hasProduct === hasVariants) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'ระบุ productId หรือ variantId อย่างใดอย่างหนึ่ง',
      });
    }
  });

/** POST /api/admin/barcodes/assign */
export const assignBarcodeSchema = z.object({
  variantId: z.string({ message: 'กรุณาระบุตัวเลือกสินค้า' }).uuid('variantId ต้องเป็น UUID'),
});

export type BarcodeLookupQuery = z.infer<typeof barcodeLookupQuerySchema>;
export type LabelRequestInput = z.infer<typeof labelRequestSchema>;
export type AssignBarcodeInput = z.infer<typeof assignBarcodeSchema>;
