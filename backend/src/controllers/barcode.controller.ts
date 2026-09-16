import type { Request, Response } from 'express';

import { assignInternalBarcode, buildLabels, lookupCode } from '../services/barcode.service.ts';
import type { AdminActor } from '../services/product-admin.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  assignBarcodeSchema,
  barcodeLookupQuerySchema,
  labelRequestSchema,
} from '../validators/barcode.validator.ts';

function actorOf(req: Request): AdminActor {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/** GET /api/admin/barcodes/lookup?code= — สแกนหรือพิมพ์โค้ดแล้วหาว่าคือของชิ้นไหน */
export const lookupBarcodeHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { code } = barcodeLookupQuerySchema.parse(req.query);

    sendSuccess(res, await lookupCode(code));
  },
);

/**
 * GET /api/admin/barcodes/labels?productId=|variantId=&symbology=&copies=
 * สร้างป้ายบาร์โค้ด/QR เป็น SVG จากข้อมูลจริงในฐานข้อมูล
 *
 * ⚠️ `variantIds` มาจาก query ชื่อ `variantId` (ซ้ำได้) — ชื่อเอกพจน์อ่านใน URL ง่ายกว่า
 */
export const buildLabelsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId, ...rest } = req.query;
    const input = labelRequestSchema.parse({
      ...rest,
      ...(variantId !== undefined ? { variantIds: variantId } : {}),
    });

    sendSuccess(res, await buildLabels(input));
  },
);

/** POST /api/admin/barcodes/assign — ออกบาร์โค้ดของร้านให้ตัวเลือกที่ยังไม่มี */
export const assignBarcodeHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId } = assignBarcodeSchema.parse(req.body);

    const result = await assignInternalBarcode(actorOf(req), variantId);

    sendSuccess(res, result, `ออกบาร์โค้ด ${result.barcode} ให้ ${result.sku} แล้ว`, 201);
  },
);
