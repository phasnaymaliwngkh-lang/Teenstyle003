import type { Request, Response } from 'express';

import { getHealthReport } from '../services/health.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';

/** GET /health — ใช้โดย load balancer, monitoring และหน้า System Status ของ frontend */
export const getHealth = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const report = await getHealthReport();

  // 503 เมื่อ dependency สำคัญล่ม เพื่อให้ตัวตรวจสุขภาพภายนอกเห็นสถานะจริง
  const isHealthy = report.status === 'ok';

  sendSuccess(
    res,
    report,
    isHealthy ? 'ระบบทำงานปกติ' : 'ระบบทำงานได้บางส่วน — มี service ที่ยังไม่พร้อม',
    isHealthy ? 200 : 503,
  );
});
