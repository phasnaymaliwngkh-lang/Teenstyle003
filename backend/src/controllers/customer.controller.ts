import type { Request, Response } from 'express';

import {
  createMyAddress,
  deleteMyAddress,
  getMyProfile,
  listMyAddresses,
  setMyDefaultAddress,
  updateMyAddress,
  updateMyProfile,
} from '../services/customer.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  addressParamsSchema,
  createAddressSchema,
  updateAddressSchema,
  updateMyProfileSchema,
} from '../validators/customer.validator.ts';

/**
 * ข้อมูลส่วนตัวและสมุดที่อยู่ของเจ้าของบัญชี (STEP 25)
 *
 * ทุก handler อ่าน `req.user!.id` เป็นเจ้าของ — **ไม่มีทางส่ง userId มาทาง body/query**
 * จึงไม่มีช่องให้แก้ข้อมูลของคนอื่น (ผ่าน requireAuth มาแล้ว)
 */

/** GET /api/users/me/profile */
export const getMyProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const profile = await getMyProfile(req.user!.id);

  sendSuccess(res, profile, 'ดึงข้อมูลส่วนตัวสำเร็จ');
});

/** PATCH /api/users/me/profile { name?, phone?, birthDate?, allowPersonalization? } */
export const updateMyProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = updateMyProfileSchema.parse(req.body);
  const profile = await updateMyProfile(req.user!.id, body);

  sendSuccess(res, profile, 'บันทึกข้อมูลส่วนตัวแล้ว');
});

/** GET /api/users/me/addresses */
export const listMyAddressesHandler = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await listMyAddresses(req.user!.id);

  sendSuccess(res, { items: addresses, total: addresses.length }, 'ดึงสมุดที่อยู่สำเร็จ');
});

/** POST /api/users/me/addresses */
export const createMyAddressHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = createAddressSchema.parse(req.body);
  const address = await createMyAddress(req.user!.id, body);

  sendSuccess(res, address, 'เพิ่มที่อยู่แล้ว', 201);
});

/** PATCH /api/users/me/addresses/:addressId */
export const updateMyAddressHandler = asyncHandler(async (req: Request, res: Response) => {
  const { addressId } = addressParamsSchema.parse(req.params);
  const body = updateAddressSchema.parse(req.body);
  const address = await updateMyAddress(req.user!.id, addressId, body);

  sendSuccess(res, address, 'บันทึกที่อยู่แล้ว');
});

/** PATCH /api/users/me/addresses/:addressId/default */
export const setMyDefaultAddressHandler = asyncHandler(async (req: Request, res: Response) => {
  const { addressId } = addressParamsSchema.parse(req.params);
  const address = await setMyDefaultAddress(req.user!.id, addressId);

  sendSuccess(res, address, 'ตั้งเป็นที่อยู่เริ่มต้นแล้ว');
});

/** DELETE /api/users/me/addresses/:addressId — soft delete (ประวัติคำสั่งซื้อยังอ้างอิงได้) */
export const deleteMyAddressHandler = asyncHandler(async (req: Request, res: Response) => {
  const { addressId } = addressParamsSchema.parse(req.params);
  const result = await deleteMyAddress(req.user!.id, addressId);

  sendSuccess(res, result, 'ลบที่อยู่ออกจากสมุดที่อยู่แล้ว');
});
