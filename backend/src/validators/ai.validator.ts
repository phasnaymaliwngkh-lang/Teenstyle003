import { z } from 'zod';

/**
 * Validator สำหรับ AI Stylist (STEP 19)
 */

export const stylistPreferencesSchema = z
  .object({
    style: z.string().trim().max(50).optional(),
    occasion: z.string().trim().max(100).optional(),
    color: z.string().trim().max(50).optional(),
    maxBudget: z.coerce.number().positive().max(1_000_000).optional(),
    size: z.string().trim().max(20).optional(),
  })
  .optional();

export const stylistChatSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุข้อความ')
    .max(1000, 'ข้อความยาวเกินไป (ไม่เกิน 1,000 ตัวอักษร)'),
  conversationId: z.string().uuid('รหัสการสนทนาไม่ถูกต้อง').optional(),
  preferences: stylistPreferencesSchema,
});

export type StylistChatInput = z.infer<typeof stylistChatSchema>;
export type StylistPreferences = z.infer<typeof stylistPreferencesSchema>;
