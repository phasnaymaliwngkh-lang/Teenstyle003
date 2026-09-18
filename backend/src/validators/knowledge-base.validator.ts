import { z } from 'zod';

export const knowledgeCategorySchema = z.enum([
  'SHIPPING',
  'RETURNS',
  'PAYMENTS',
  'SIZING',
  'CARE',
  'ORDERS',
  'GENERAL',
  'STYLING',
]);

export const faqItemSchema = z.object({
  id: z.string().optional(),
  question: z.string({ message: 'กรุณาระบุคำถาม FAQ' }).min(2, 'คำถามต้องมีอย่างน้อย 2 ตัวอักษร'),
  answer: z.string({ message: 'กรุณาระบุคำตอบ FAQ' }).min(2, 'คำตอบต้องมีอย่างน้อย 2 ตัวอักษร'),
});

export const createKnowledgeArticleSchema = z.object({
  title: z
    .string({ message: 'กรุณาระบุหัวข้อบทความ' })
    .min(3, 'หัวข้อต้องมีความยาวอย่างน้อย 3 ตัวอักษร')
    .max(200, 'หัวข้อยาวเกินไป (สูงสุด 200 ตัวอักษร)'),
  slug: z
    .string({ message: 'กรุณาระบุ slug' })
    .min(3, 'Slug ต้องมีความยาวอย่างน้อย 3 ตัวอักษร')
    .max(100, 'Slug ยาวเกินไป')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug ต้องเป็นตัวอักษรพิมพ์เล็ก ตัวเลข และเครื่องหมายขีด (-) เท่านั้น',
    ),
  category: knowledgeCategorySchema,
  summary: z
    .string({ message: 'กรุณาระบุบทสรุปย่อ' })
    .min(5, 'บทสรุปย่อต้องมีความยาวอย่างน้อย 5 ตัวอักษร')
    .max(500, 'บทสรุปย่อยาวเกินไป (สูงสุด 500 ตัวอักษร)'),
  content: z
    .string({ message: 'กรุณาระบุเนื้อหาบทความ' })
    .min(10, 'เนื้อหาต้องมีความยาวอย่างน้อย 10 ตัวอักษร'),
  tags: z.array(z.string().trim().min(1)).default([]),
  faqPairs: z.array(faqItemSchema).default([]),
  isPublished: z.boolean().default(true),
});

export const updateKnowledgeArticleSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug ต้องเป็นตัวอักษรพิมพ์เล็ก ตัวเลข และเครื่องหมายขีด (-) เท่านั้น',
    )
    .optional(),
  category: knowledgeCategorySchema.optional(),
  summary: z.string().min(5).max(500).optional(),
  content: z.string().min(10).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  faqPairs: z.array(faqItemSchema).optional(),
  isPublished: z.boolean().optional(),
});

export const knowledgeSearchQuerySchema = z.object({
  q: z.string().trim().optional(),
  category: knowledgeCategorySchema.optional(),
  tag: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const askKnowledgeSchema = z.object({
  query: z
    .string({ message: 'กรุณาระบุคำถามที่ต้องการค้นหา' })
    .trim()
    .min(2, 'คำถามต้องมีความยาวอย่างน้อย 2 ตัวอักษร')
    .max(500, 'คำถามยาวเกินไป (สูงสุด 500 ตัวอักษร)'),
  category: knowledgeCategorySchema.optional(),
});

export const voteHelpfulSchema = z.object({
  helpful: z.boolean({ message: 'กรุณาระบุค่า helpful (true/false)' }),
});

export type CreateKnowledgeArticleInput = z.infer<typeof createKnowledgeArticleSchema>;
export type UpdateKnowledgeArticleInput = z.infer<typeof updateKnowledgeArticleSchema>;
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;
export type AskKnowledgeInput = z.infer<typeof askKnowledgeSchema>;
