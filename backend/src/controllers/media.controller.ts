import type { Request, Response } from 'express';

import { getMediaLibrary, purgeUnusedMedia } from '../services/media.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { mediaLibraryQuerySchema } from '../validators/media.validator.ts';

/** GET /api/admin/media?purpose=&usage=&page=&limit= — อ่านอย่างเดียว */
export const getMediaLibraryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = mediaLibraryQuerySchema.parse(req.query);

    sendSuccess(res, await getMediaLibrary(query));
  },
);

/** POST /api/admin/media/purge — ลบไฟล์ที่ไม่มีที่ไหนใช้เกินช่วงผ่อนผัน */
export const purgeMediaHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const result = await purgeUnusedMedia({
      id: req.user!.id,
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });

    sendSuccess(
      res,
      result,
      result.deleted > 0
        ? `ลบไฟล์ที่ไม่ได้ใช้แล้ว ${result.deleted} ไฟล์`
        : 'ไม่มีไฟล์ที่ลบได้ตอนนี้',
    );
  },
);
