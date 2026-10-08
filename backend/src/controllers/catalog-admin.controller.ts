import type { Request, Response } from 'express';

import {
  createBrand,
  createCategory,
  createColor,
  createSize,
  deleteBrand,
  deleteCategory,
  deleteVariantOption,
  getCatalogOverview,
  reorderCategories,
  reorderVariantOptions,
  updateBrand,
  updateCategory,
  updateColor,
  updateSize,
} from '../services/catalog-admin.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  catalogIdParamsSchema,
  createBrandSchema,
  createCategorySchema,
  createColorSchema,
  createSizeSchema,
  reorderCategoriesSchema,
  reorderSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateColorSchema,
  updateSizeSchema,
} from '../validators/catalog-admin.validator.ts';

/**
 * หมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *
 * ทุกการเปลี่ยนตอบด้วยภาพรวมชุดใหม่ทั้งหมด — จำนวนการใช้งานและเหตุผลที่ "ทำไม่ได้"
 * ของรายการอื่นเปลี่ยนตามได้ (เช่น ปิดหมวดย่อยแล้วหมวดแม่ปิดได้) หน้าเว็บจึงไม่ต้องเดาเอง
 */

function actorOf(req: Request) {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

async function respond(res: Response, message: string, status = 200): Promise<void> {
  sendSuccess(res, await getCatalogOverview(), message, status);
}

/** GET /api/admin/catalog */
export const getCatalogHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await getCatalogOverview());
});

/* ── หมวดหมู่ ── */

export const createCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  await createCategory(actorOf(req), createCategorySchema.parse(req.body));
  await respond(res, 'เพิ่มหมวดหมู่แล้ว', 201);
});

export const updateCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await updateCategory(actorOf(req), id, updateCategorySchema.parse(req.body));
  await respond(res, 'บันทึกหมวดหมู่แล้ว');
});

export const deleteCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await deleteCategory(actorOf(req), id);
  await respond(res, 'ลบหมวดหมู่แล้ว');
});

export const reorderCategoriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { parentId, ids } = reorderCategoriesSchema.parse(req.body);
  await reorderCategories(actorOf(req), parentId, ids);
  await respond(res, 'เรียงหมวดหมู่ใหม่แล้ว');
});

/* ── แบรนด์ ── */

export const createBrandHandler = asyncHandler(async (req: Request, res: Response) => {
  await createBrand(actorOf(req), createBrandSchema.parse(req.body));
  await respond(res, 'เพิ่มแบรนด์แล้ว', 201);
});

export const updateBrandHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await updateBrand(actorOf(req), id, updateBrandSchema.parse(req.body));
  await respond(res, 'บันทึกแบรนด์แล้ว');
});

export const deleteBrandHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await deleteBrand(actorOf(req), id);
  await respond(res, 'ลบแบรนด์แล้ว');
});

/* ── ไซซ์ ── */

export const createSizeHandler = asyncHandler(async (req: Request, res: Response) => {
  await createSize(actorOf(req), createSizeSchema.parse(req.body));
  await respond(res, 'เพิ่มไซซ์แล้ว', 201);
});

export const updateSizeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await updateSize(actorOf(req), id, updateSizeSchema.parse(req.body));
  await respond(res, 'บันทึกไซซ์แล้ว');
});

export const deleteSizeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await deleteVariantOption(actorOf(req), 'size', id);
  await respond(res, 'ลบไซซ์แล้ว');
});

export const reorderSizesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = reorderSchema.parse(req.body);
  await reorderVariantOptions(actorOf(req), 'size', ids);
  await respond(res, 'เรียงไซซ์ใหม่แล้ว');
});

/* ── สี ── */

export const createColorHandler = asyncHandler(async (req: Request, res: Response) => {
  await createColor(actorOf(req), createColorSchema.parse(req.body));
  await respond(res, 'เพิ่มสีแล้ว', 201);
});

export const updateColorHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await updateColor(actorOf(req), id, updateColorSchema.parse(req.body));
  await respond(res, 'บันทึกสีแล้ว');
});

export const deleteColorHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = catalogIdParamsSchema.parse(req.params);
  await deleteVariantOption(actorOf(req), 'color', id);
  await respond(res, 'ลบสีแล้ว');
});

export const reorderColorsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = reorderSchema.parse(req.body);
  await reorderVariantOptions(actorOf(req), 'color', ids);
  await respond(res, 'เรียงสีใหม่แล้ว');
});
