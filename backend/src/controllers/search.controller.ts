import type { Request, Response } from 'express';

import { searchCatalog, suggestSearch } from '../services/search.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { searchQuerySchema, suggestQuerySchema } from '../validators/search.validator.ts';

/** GET /api/search?q=&literal=&sort=&page=&limit= — ค้นหาทั้งร้าน (STEP 45) */
export const searchHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = searchQuerySchema.parse(req.query);

  sendSuccess(res, await searchCatalog(query), 'ค้นหาสำเร็จ');
});

/** GET /api/search/suggest?q= — คำแนะนำระหว่างพิมพ์ */
export const suggestHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = suggestQuerySchema.parse(req.query);

  sendSuccess(res, await suggestSearch(query), 'ดึงคำแนะนำสำเร็จ');
});
