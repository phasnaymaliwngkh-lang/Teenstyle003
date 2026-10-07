import { z } from 'zod';

/** คลังรูปในหลังบ้าน (STEP 47) */
export const mediaLibraryQuerySchema = z.object({
  purpose: z
    .enum(['PRODUCT', 'REVIEW'], { message: 'purpose ต้องเป็น PRODUCT หรือ REVIEW' })
    .optional()
    .transform((value) => value ?? null),
  usage: z
    .enum(['all', 'in-use', 'unused'], { message: 'usage ต้องเป็น all, in-use หรือ unused' })
    .default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type MediaLibraryQueryInput = z.infer<typeof mediaLibraryQuerySchema>;
