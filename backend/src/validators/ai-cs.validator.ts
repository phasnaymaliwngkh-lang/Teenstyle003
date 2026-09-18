import { z } from 'zod';

/**
 * Validator สำหรับ AI Customer Service & Human Handoff (STEP 20)
 */

export const csChatSchema = z.object({
  message: z
    .string({ message: 'กรุณาระบุข้อความ' })
    .trim()
    .min(1, 'กรุณาระบุข้อความอย่างน้อย 1 ตัวอักษร')
    .max(1000, 'ข้อความยาวเกินไป (ไม่เกิน 1,000 ตัวอักษร)'),
  conversationId: z.string().uuid('รหัสการสนทนาไม่ถูกต้อง').optional(),
});

export const csEscalateSchema = z.object({
  conversationId: z.string({ message: 'ต้องระบุรหัสการสนทนา' }).uuid('รหัสการสนทนาไม่ถูกต้อง'),
  reason: z.string().trim().max(500, 'เหตุผลยาวเกินไป').optional(),
});

export const adminSupportReplySchema = z.object({
  message: z
    .string({ message: 'กรุณาระบุข้อความตอบกลับ' })
    .trim()
    .min(1, 'ข้อความตอบกลับต้องมีอย่างน้อย 1 ตัวอักษร')
    .max(2000, 'ข้อความตอบกลับยาวเกินไป (ไม่เกิน 2,000 ตัวอักษร)'),
});

export const adminSupportStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'ESCALATED', 'CLOSED'], {
    message: 'สถานะไม่ถูกต้อง (ACTIVE, ESCALATED, หรือ CLOSED เท่านั้น)',
  }),
});

export type CsChatInput = z.infer<typeof csChatSchema>;
export type CsEscalateInput = z.infer<typeof csEscalateSchema>;
export type AdminSupportReplyInput = z.infer<typeof adminSupportReplySchema>;
export type AdminSupportStatusInput = z.infer<typeof adminSupportStatusSchema>;
