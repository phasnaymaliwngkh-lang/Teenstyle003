import type { Request, Response } from 'express';

import {
  addVariant,
  archiveProduct,
  createProduct,
  getAdminProduct,
  getProductFormOptions,
  listAdminProducts,
  updateProduct,
  updateVariant,
  type AdminActor,
} from '../services/product-admin.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  addVariantSchema,
  adminProductListQuerySchema,
  createProductSchema,
  productIdParamsSchema,
  updateProductSchema,
  updateVariantSchema,
  variantIdParamsSchema,
} from '../validators/product-admin.validator.ts';

/** ข้อมูลผู้ทำรายการ — เก็บลง AdminLog เพื่อตรวจย้อนหลัง */
function actorOf(req: Request): AdminActor {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/** GET /api/admin/products?q=&status=&categorySlug=&lowStock=&page=&limit= */
export const listAdminProductsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = adminProductListQuerySchema.parse(req.query);

    sendSuccess(res, await listAdminProducts(query));
  },
);

/** GET /api/admin/products/options — หมวดหมู่/แบรนด์/สี/ไซซ์ ที่มีจริงในระบบ */
export const getProductOptionsHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await getProductFormOptions());
  },
);

/** GET /api/admin/products/:productId */
export const getAdminProductHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);

    sendSuccess(res, await getAdminProduct(productId));
  },
);

/** POST /api/admin/products */
export const createProductHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const input = createProductSchema.parse(req.body);

    const product = await createProduct(actorOf(req), input);

    sendSuccess(res, product, 'สร้างสินค้าแล้ว', 201);
  },
);

/** PATCH /api/admin/products/:productId */
export const updateProductHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);
    const input = updateProductSchema.parse(req.body);

    const product = await updateProduct(actorOf(req), productId, input);

    sendSuccess(res, product, 'บันทึกการแก้ไขแล้ว');
  },
);

/** DELETE /api/admin/products/:productId — soft delete */
export const deleteProductHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);

    const result = await archiveProduct(actorOf(req), productId);

    sendSuccess(
      res,
      result,
      result.orderItemCount > 0
        ? `ลบสินค้าแล้ว (เก็บข้อมูลไว้เพราะมีประวัติการสั่งซื้อ ${result.orderItemCount} รายการ)`
        : 'ลบสินค้าแล้ว',
    );
  },
);

/** POST /api/admin/products/:productId/variants */
export const addVariantHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId } = productIdParamsSchema.parse(req.params);
    const input = addVariantSchema.parse(req.body);

    const product = await addVariant(actorOf(req), productId, input);

    sendSuccess(res, product, 'เพิ่มตัวเลือกสินค้าแล้ว', 201);
  },
);

/** PATCH /api/admin/products/:productId/variants/:variantId */
export const updateVariantHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { productId, variantId } = variantIdParamsSchema.parse(req.params);
    const input = updateVariantSchema.parse(req.body);

    const product = await updateVariant(actorOf(req), productId, variantId, input);

    sendSuccess(res, product, 'บันทึกตัวเลือกสินค้าแล้ว');
  },
);
