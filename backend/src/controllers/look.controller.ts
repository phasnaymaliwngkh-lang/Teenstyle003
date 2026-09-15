import type { Request, Response } from 'express';

import {
  checkLookAvailability,
  getLookBySlug,
  getLookFilters,
  searchLooks,
} from '../services/look.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  lookAvailabilityBodySchema,
  lookQuerySchema,
  lookSlugParamsSchema,
} from '../validators/look.validator.ts';

/** Endpoint ของหน้า /looks (STEP 7) และ /looks/[slug] (STEP 8) — เปิดสาธารณะ แต่ validate ทุกค่า */

/** GET /api/looks/search?q&style&minPrice&maxPrice&available&sort&page&limit */
export const searchLooksHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = lookQuerySchema.parse(req.query);

    const result = await searchLooks(query);

    sendSuccess(res, result);
  },
);

/** GET /api/looks/filters — สไตล์ที่มีอยู่จริง + ช่วงราคารวม */
export const getLookFiltersHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const filters = await getLookFilters();

    sendSuccess(res, filters);
  },
);

/** GET /api/looks/:slug — รายละเอียดลุคพร้อม variant ของสินค้าทุกชิ้น (STEP 8) */
export const getLookHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { slug } = lookSlugParamsSchema.parse(req.params);

  const look = await getLookBySlug(slug);

  sendSuccess(res, look);
});

/** POST /api/looks/:slug/availability — ตรวจว่าซื้อทั้งชุดได้จริงไหม (STEP 8) */
export const checkLookAvailabilityHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { slug } = lookSlugParamsSchema.parse(req.params);
    const { selections } = lookAvailabilityBodySchema.parse(req.body);

    const result = await checkLookAvailability(slug, selections);

    sendSuccess(
      res,
      result,
      result.purchasable ? 'ซื้อทั้งชุดได้' : 'ยังซื้อทั้งชุดไม่ได้ — ดูรายละเอียดในแต่ละชิ้น',
    );
  },
);
