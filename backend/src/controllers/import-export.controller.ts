import type { Request, Response } from 'express';
import { z } from 'zod';

import {
  exportInventory,
  exportOrders,
  exportProducts,
  getTemplate,
  importInventory,
  importProducts,
} from '../services/import-export.service.ts';
import type { AdminActor } from '../services/product-admin.service.ts';
import { ApiError } from '../utils/api-error.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  exportInventoryQuerySchema,
  exportOrdersQuerySchema,
  exportProductsQuerySchema,
  importQuerySchema,
  templateQuerySchema,
} from '../validators/import-export.validator.ts';

function actorOf(req: Request): AdminActor {
  return {
    id: req.user!.id,
    ip: req.ip,
    userAgent: req.header('user-agent'),
  };
}

/** GET /api/admin/export/products — ส่งออกสินค้าเป็น CSV / Excel */
export const exportProductsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = exportProductsQuerySchema.parse(req.query);
    const result = await exportProducts(query);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  },
);

/** GET /api/admin/export/inventory — ส่งออกคลังสินค้าเป็น CSV / Excel */
export const exportInventoryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = exportInventoryQuerySchema.parse(req.query);
    const result = await exportInventory(query);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  },
);

/** GET /api/admin/export/orders — ส่งออกคำสั่งซื้อเป็น CSV / Excel */
export const exportOrdersHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = exportOrdersQuerySchema.parse(req.query);
    const result = await exportOrders(query);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  },
);

/** GET /api/admin/export/templates/:type — ดาวน์โหลด template สำหรับนำเข้า */
export const downloadTemplateHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const type = z.enum(['products', 'inventory'], {
      message: 'ประเภท template ต้องเป็น products หรือ inventory เท่านั้น',
    }).parse(req.params.type);

    const { format } = templateQuerySchema.parse(req.query);
    const result = await getTemplate(type, format);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.buffer);
  },
);

/** POST /api/admin/import/products — นำเข้าสินค้าและตัวเลือก (CSV / Excel) */
export const importProductsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      throw ApiError.badRequest('กรุณาเลือกไฟล์ที่ต้องการนำเข้า (CSV หรือ Excel)');
    }

    const { dryRun } = importQuerySchema.parse(req.query);
    const actor = actorOf(req);

    const result = await importProducts(
      actor,
      req.file.buffer,
      req.file.originalname,
      dryRun,
    );

    sendSuccess(
      res,
      result,
      result.dryRun
        ? result.success
          ? 'ตรวจสอบความถูกต้องของไฟล์สินค้าสำเร็จ พร้อมนำเข้า'
          : 'พบข้อผิดพลาดในไฟล์สินค้า กรุณาแก้ไขก่อนนำเข้า'
        : 'นำเข้าข้อมูลสินค้าเรียบร้อยแล้ว',
    );
  },
);

/** POST /api/admin/import/inventory — ปรับปรุงสต็อกเป็นชุด (Stock Take) */
export const importInventoryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      throw ApiError.badRequest('กรุณาเลือกไฟล์ที่ต้องการนำเข้า (CSV หรือ Excel)');
    }

    const { dryRun } = importQuerySchema.parse(req.query);
    const actor = actorOf(req);

    const result = await importInventory(
      actor,
      req.file.buffer,
      req.file.originalname,
      dryRun,
    );

    sendSuccess(
      res,
      result,
      result.dryRun
        ? result.success
          ? 'ตรวจสอบความถูกต้องของไฟล์สต็อกสำเร็จ พร้อมนำเข้า'
          : 'พบข้อผิดพลาดในไฟล์สต็อก กรุณาแก้ไขก่อนนำเข้า'
        : 'ปรับปรุงยอดสต็อกสินค้าเรียบร้อยแล้ว',
    );
  },
);

