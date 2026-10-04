import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { AdminCouponListResult } from "@/types/admin";

/**
 * อ่านรายการคูปองจากฝั่ง server (STEP 41)
 *
 * `cache: "no-store"` เพราะสถานะคูปอง (ใช้ครบแล้วหรือยัง) เปลี่ยนตลอดเวลาตามการสั่งซื้อ
 * ถ้าแคช แอดมินจะเห็นว่าคูปองยังใช้ได้ทั้งที่เต็มไปแล้ว
 */
export function fetchAdminCouponsOnServer(params: URLSearchParams): Promise<AdminCouponListResult> {
  const qs = params.toString();

  return apiFetchAsUser<AdminCouponListResult>(`/api/admin/coupons${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}
