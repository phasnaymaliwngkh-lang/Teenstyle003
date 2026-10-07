import type { Request, Response } from 'express';

import {
  addProductImage,
  listProductImages,
  removeProductImage,
  reorderProductImages,
  updateProductImageAlt,
} from '../services/product-image.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  productIdParamsSchema,
  productImageParamsSchema,
  reorderProductImagesSchema,
  updateProductImageSchema,
  uploadProductImageSchema,
} from '../validators/product-admin.validator.ts';

/** ข้อมูลผู้ทำรายการ — เก็บลง AdminLog เพื่อตรวจย้อนหลัง */
function actorOf(req: Request): { id: string; ip?: string; userAgent?: string } {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/** GET /api/admin/products/:productId/images */
export const listProductImagesHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);

    sendSuccess(res, await listProductImages(productId));
  },
);

/** POST /api/admin/products/:productId/images — multipart: `file` + `alt` */
export const uploadProductImageHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);
    const { alt } = uploadProductImageSchema.parse(req.body);

    const images = await addProductImage(actorOf(req), productId, req.file!.buffer, alt);

    sendSuccess(res, images, 'เพิ่มรูปแล้ว', 201);
  },
);

/** PATCH /api/admin/products/:productId/images/:imageId — แก้คำอธิบายรูป */
export const updateProductImageHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId, imageId } = productImageParamsSchema.parse(req.params);
    const { alt } = updateProductImageSchema.parse(req.body);

    sendSuccess(
      res,
      await updateProductImageAlt(actorOf(req), productId, imageId, alt),
      'บันทึกแล้ว',
    );
  },
);

/** PUT /api/admin/products/:productId/images/order — รูปแรกคือรูปหลัก */
export const reorderProductImagesHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);
    const { imageIds } = reorderProductImagesSchema.parse(req.body);

    sendSuccess(
      res,
      await reorderProductImages(actorOf(req), productId, imageIds),
      'เรียงรูปใหม่แล้ว',
    );
  },
);

/** DELETE /api/admin/products/:productId/images/:imageId — ถอดรูปออก (ไฟล์ถูกลบทีหลังโดยตัวล้างไฟล์) */
export const removeProductImageHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId, imageId } = productImageParamsSchema.parse(req.params);

    sendSuccess(res, await removeProductImage(actorOf(req), productId, imageId), 'ถอดรูปแล้ว');
  },
);
