import { z } from "zod";

import { SHIPPING_METHODS } from "@/types/catalog";

/**
 * กฎตรวจฟอร์ม checkout ฝั่ง client (STEP 10)
 *
 * ⚠️ นี่คือการช่วยผู้ใช้ไม่ให้กรอกผิด **ไม่ใช่การป้องกัน**
 *    กฎชุดเดียวกันถูกตรวจซ้ำที่ backend (`order.validator.ts`) ซึ่งเป็นด่านจริง
 *    ถ้าแก้ที่นี่ ต้องแก้ฝั่ง backend ให้ตรงกันด้วย
 */

const phone = z
  .string()
  .trim()
  .min(9, "เบอร์โทรสั้นเกินไป")
  .max(20, "เบอร์โทรยาวเกินไป")
  .regex(/^[0-9+\-\s()]+$/, "กรอกได้เฉพาะตัวเลข + - ( ) และเว้นวรรค");

export const checkoutFormSchema = z
  .object({
    /** "new" = กรอกที่อยู่ใหม่ · ค่าอื่นคือ id ของที่อยู่ที่บันทึกไว้ */
    addressChoice: z.string().min(1, "กรุณาเลือกที่อยู่จัดส่ง"),
    label: z.string().trim().max(60).optional(),
    recipientName: z.string().trim().max(120).optional(),
    phone: z.string().trim().optional(),
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    subDistrict: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().optional(),
    saveForLater: z.boolean(),
    shippingMethod: z.enum(SHIPPING_METHODS),
    customerNote: z.string().trim().max(500, "ข้อความถึงร้านยาวเกินไป").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.addressChoice !== "new") return;

    // ตรวจช่องที่อยู่ใหม่เฉพาะเมื่อผู้ใช้เลือกกรอกใหม่
    const required: [keyof typeof value, string, number][] = [
      ["recipientName", "กรุณากรอกชื่อผู้รับ", 2],
      ["line1", "กรุณากรอกที่อยู่", 5],
      ["subDistrict", "กรุณากรอกแขวง/ตำบล", 2],
      ["district", "กรุณากรอกเขต/อำเภอ", 2],
      ["province", "กรุณากรอกจังหวัด", 2],
    ];

    for (const [field, message, min] of required) {
      const text = value[field];
      if (typeof text !== "string" || text.trim().length < min) {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }

    const phoneResult = phone.safeParse(value.phone ?? "");
    if (!phoneResult.success) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: phoneResult.error.issues[0]?.message ?? "เบอร์โทรไม่ถูกต้อง",
      });
    }

    if (!/^\d{5}$/.test(value.postalCode ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก",
      });
    }
  });

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;
