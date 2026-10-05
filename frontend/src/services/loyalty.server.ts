import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { AdminPointTransactionList, MyLoyalty, PointTransactionList } from "@/types/loyalty";

/**
 * อ่านแต้มสะสมจากฝั่ง server (STEP 42)
 *
 * `cache: "no-store"` ทุกเส้นทาง — แต้มเป็นข้อมูลรายบุคคลที่มีมูลค่าเท่าเงิน
 * **ห้ามถูกแคชร่วมกับผู้ใช้คนอื่น** และต้องเป็นยอดล่าสุดเสมอ (เพิ่งใช้แต้มไปต้องเห็นทันที)
 */

export function fetchMyLoyaltyOnServer(): Promise<MyLoyalty> {
  return apiFetchAsUser<MyLoyalty>("/api/users/me/loyalty", { cache: "no-store" });
}

export function fetchMyPointTransactionsOnServer(
  page: number,
  limit = 20,
): Promise<PointTransactionList> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });

  return apiFetchAsUser<PointTransactionList>(`/api/users/me/loyalty/transactions?${query}`, {
    cache: "no-store",
  });
}

/** ประวัติแต้มของลูกค้าในหลังบ้าน (`customer:read`) */
export function fetchCustomerPointsOnServer(
  userId: string,
  page = 1,
  limit = 10,
): Promise<AdminPointTransactionList> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });

  return apiFetchAsUser<AdminPointTransactionList>(
    `/api/admin/customers/${encodeURIComponent(userId)}/points?${query}`,
    { cache: "no-store" },
  );
}
