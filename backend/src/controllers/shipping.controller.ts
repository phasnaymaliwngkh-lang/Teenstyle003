import type { Request, Response } from 'express';

import { describeFreeShipping } from '../models/shipping.model.ts';
import {
  adminCreateShipment,
  adminGetShipment,
  adminListShipments,
  adminUpdateShipment,
  adminUpdateShipmentStatus,
} from '../services/shipment.service.ts';
import {
  activeShippingOptions,
  adminListShippingRates,
  adminUpdateShippingRate,
} from '../services/shipping.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { orderNumberParamsSchema } from '../validators/order.validator.ts';
import {
  adminShipmentQuerySchema,
  createShipmentSchema,
  shipmentParamsSchema,
  shippingMethodParamsSchema,
  updateShipmentSchema,
  updateShipmentStatusSchema,
  updateShippingRateSchema,
} from '../validators/shipping.validator.ts';

/**
 * การจัดส่ง (STEP 44) — อัตราค่าส่งที่ร้านแก้ได้ + พัสดุ
 * ฝั่งร้านส่งตัวตนจริงจาก session (+ ip/user-agent) ไปให้ service เขียน AdminLog
 */

const actorOf = (req: Request) => ({
  id: req.user!.id,
  ip: req.ip,
  userAgent: req.header('user-agent'),
});

/**
 * GET /api/shipping/options — วิธีจัดส่งที่เปิดใช้ (สาธารณะ)
 *
 * `freeShippingFrom` = ยอดส่งฟรีที่ต่ำที่สุดของวิธีที่ส่งได้ทั่วประเทศ (null = ไม่มีโปร)
 * หน้าแรกใช้ตัวเลขนี้ — ไม่พิมพ์ "ส่งฟรีเมื่อครบ …" ไว้ในซอร์สอีก (เดิมพิมพ์ 690 ซึ่งเป็นเงื่อนไขของคูปอง
 * ที่ต้องกรอกรหัส ไม่ใช่ส่งฟรีอัตโนมัติ · แก้ตอน STEP 44)
 */
export const getShippingOptionsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const options = await activeShippingOptions();
  const nationwideFree = options
    .filter((option) => option.onlyProvinces === null && option.freeOverSubtotal !== null)
    .map((option) => option.freeOverSubtotal!);

  sendSuccess(
    res,
    {
      options: options.map(({ isActive: _active, sortOrder: _order, ...option }) => option),
      freeShippingFrom: nationwideFree.length > 0 ? Math.min(...nationwideFree) : null,
      freeShippingText: describeFreeShipping(options),
    },
    'ดึงวิธีจัดส่งสำเร็จ',
  );
});

/** GET /api/admin/shipping/rates */
export const adminListShippingRatesHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await adminListShippingRates(), 'ดึงอัตราค่าจัดส่งสำเร็จ');
});

/** PATCH /api/admin/shipping/rates/:method */
export const adminUpdateShippingRateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { method } = shippingMethodParamsSchema.parse(req.params);
  const body = updateShippingRateSchema.parse(req.body);
  const rate = await adminUpdateShippingRate(actorOf(req), method, body);

  sendSuccess(res, rate, 'บันทึกอัตราค่าจัดส่งแล้ว — มีผลกับคำสั่งซื้อใหม่ตั้งแต่ตอนนี้');
});

/** GET /api/admin/shipments?status=&overdue=&q=&page=&limit= */
export const adminListShipmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminShipmentQuerySchema.parse(req.query);

  sendSuccess(res, await adminListShipments(query), 'ดึงรายการพัสดุสำเร็จ');
});

/** GET /api/admin/shipments/:shipmentId */
export const adminGetShipmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { shipmentId } = shipmentParamsSchema.parse(req.params);

  sendSuccess(res, await adminGetShipment(shipmentId), 'ดึงข้อมูลพัสดุสำเร็จ');
});

/** PATCH /api/admin/shipments/:shipmentId/status { status, note? } */
export const adminUpdateShipmentStatusHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { shipmentId } = shipmentParamsSchema.parse(req.params);
    const body = updateShipmentStatusSchema.parse(req.body);

    sendSuccess(
      res,
      await adminUpdateShipmentStatus(actorOf(req), shipmentId, body),
      'บันทึกสถานะพัสดุแล้ว',
    );
  },
);

/** PATCH /api/admin/shipments/:shipmentId { carrier?, trackingNumber?, trackingUrl?, estimatedDelivery?, reason } */
export const adminUpdateShipmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { shipmentId } = shipmentParamsSchema.parse(req.params);
  const body = updateShipmentSchema.parse(req.body);

  sendSuccess(res, await adminUpdateShipment(actorOf(req), shipmentId, body), 'แก้ข้อมูลพัสดุแล้ว');
});

/** POST /api/admin/orders/:orderNumber/shipments — ส่งพัสดุชิ้นใหม่หลังถูกตีกลับ */
export const adminCreateShipmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber } = orderNumberParamsSchema.parse(req.params);
  const body = createShipmentSchema.parse(req.body);

  sendSuccess(
    res,
    await adminCreateShipment(actorOf(req), orderNumber, body),
    'บันทึกการส่งพัสดุใหม่แล้ว',
    201,
  );
});
