import type { Request, Response } from 'express';

import {
  adminGetCustomer,
  adminListCustomers,
  adminUpdateCustomerRole,
  adminUpdateCustomerStatus,
  type CustomerActor,
} from '../services/admin-customer.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  adminCustomerQuerySchema,
  customerParamsSchema,
  updateCustomerRoleSchema,
  updateCustomerStatusSchema,
} from '../validators/customer.validator.ts';

/**
 * จัดการลูกค้าจากหลังบ้าน (STEP 25)
 *
 * ⚠️ `actorOf` ส่ง **บทบาทจริงจาก session** ไปให้ service ไม่ใช่ค่าที่ client แนบมา
 *    กฎ "แตะได้แค่บัญชีที่บทบาทต่ำกว่าตัวเอง" จะไม่มีความหมายเลยถ้าบทบาทมาจาก body
 */
function actorOf(req: Request): CustomerActor {
  return {
    id: req.user!.id,
    role: req.user!.role,
    ip: req.ip,
    userAgent: req.header('user-agent'),
  };
}

/** GET /api/admin/customers?q=&status=&role=&tier=&sort=&page=&limit= */
export const listAdminCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = adminCustomerQuerySchema.parse(req.query);
  const result = await adminListCustomers(query);

  sendSuccess(res, result, 'ดึงรายการลูกค้าสำเร็จ');
});

/** GET /api/admin/customers/:userId */
export const getAdminCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = customerParamsSchema.parse(req.params);
  const customer = await adminGetCustomer(userId);

  sendSuccess(res, customer, 'ดึงข้อมูลลูกค้าสำเร็จ');
});

/** PATCH /api/admin/customers/:userId/status { status, reason } */
export const updateCustomerStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = customerParamsSchema.parse(req.params);
  const body = updateCustomerStatusSchema.parse(req.body);
  const customer = await adminUpdateCustomerStatus(userId, body, actorOf(req));

  sendSuccess(res, customer, 'บันทึกสถานะบัญชีแล้ว');
});

/** PATCH /api/admin/customers/:userId/role { role, reason } */
export const updateCustomerRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = customerParamsSchema.parse(req.params);
  const body = updateCustomerRoleSchema.parse(req.body);
  const customer = await adminUpdateCustomerRole(userId, body, actorOf(req));

  sendSuccess(res, customer, 'บันทึกบทบาทของบัญชีแล้ว');
});
