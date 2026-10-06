import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AdminReturnList,
  AdminReturnRequest,
  ReturnEligibility,
  ReturnList,
} from "@/types/returns";

/**
 * อ่านข้อมูลการคืนสินค้าจากฝั่ง server (STEP 43)
 *
 * `cache: "no-store"` ทุกเส้นทาง — เป็นข้อมูลรายบุคคลและเรื่องเงิน ต้องเป็นสถานะล่าสุดเสมอ
 * และห้ามถูกแคชร่วมกับผู้ใช้คนอื่น
 */

export function fetchReturnEligibilityOnServer(orderNumber: string): Promise<ReturnEligibility> {
  return apiFetchAsUser<ReturnEligibility>(
    `/api/returns/eligibility/${encodeURIComponent(orderNumber)}`,
    { cache: "no-store" },
  );
}

export function fetchMyReturnsOnServer(page: number): Promise<ReturnList> {
  return apiFetchAsUser<ReturnList>(`/api/returns?page=${page}&limit=10`, { cache: "no-store" });
}

export function fetchAdminReturnsOnServer(params: URLSearchParams): Promise<AdminReturnList> {
  const qs = params.toString();

  return apiFetchAsUser<AdminReturnList>(`/api/admin/returns${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchAdminReturnOnServer(returnId: string): Promise<AdminReturnRequest> {
  return apiFetchAsUser<AdminReturnRequest>(`/api/admin/returns/${encodeURIComponent(returnId)}`, {
    cache: "no-store",
  });
}
