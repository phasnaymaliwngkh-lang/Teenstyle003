import type { Request, Response } from 'express';

import {
  adjustStock,
  getVariantInventory,
  listInventory,
  listMovements,
} from '../services/inventory-admin.service.ts';
import type { AdminActor } from '../services/product-admin.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adjustStockSchema,
  inventoryListQuerySchema,
  inventoryVariantParamsSchema,
  movementListQuerySchema,
} from '../validators/inventory.validator.ts';

/** ข้อมูลผู้ทำรายการ — เก็บลง InventoryMovement และ AdminLog */
function actorOf(req: Request): AdminActor {
  return { id: req.user!.id, ip: req.ip, userAgent: req.header('user-agent') };
}

/** GET /api/admin/inventory?q=&stockStatus=&categorySlug=&sort=&page=&limit= */
export const listInventoryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = inventoryListQuerySchema.parse(req.query);

    sendSuccess(res, await listInventory(query));
  },
);

/** GET /api/admin/inventory/movements?variantId=&productId=&type=&page=&limit= */
export const listMovementsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = movementListQuerySchema.parse(req.query);

    sendSuccess(res, await listMovements(query));
  },
);

/** GET /api/admin/inventory/:variantId */
export const getVariantInventoryHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId } = inventoryVariantParamsSchema.parse(req.params);

    sendSuccess(res, await getVariantInventory(variantId));
  },
);

/** POST /api/admin/inventory/:variantId/adjust — รับเข้า / ตัดออก / ปรับยอดตามการตรวจนับ */
export const adjustStockHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId } = inventoryVariantParamsSchema.parse(req.params);
    const input = adjustStockSchema.parse(req.body);

    const result = await adjustStock(actorOf(req), variantId, input);

    const message =
      input.type === 'STOCK_IN'
        ? 'รับของเข้าคลังแล้ว'
        : input.type === 'STOCK_OUT'
          ? 'ตัดของออกจากคลังแล้ว'
          : 'ปรับยอดตามการตรวจนับแล้ว';

    sendSuccess(res, result, message);
  },
);
