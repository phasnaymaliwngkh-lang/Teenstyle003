import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AdminLogFilters,
  AdminLogListResult,
  LogTargetType,
  TargetHistoryResult,
} from "@/types/admin-log";

/**
 * อ่าน Audit log จากฝั่ง server (STEP 27)
 *
 * `cache: "no-store"` ทุกเส้นทาง — ประวัติต้องเป็นของจริง ณ ตอนเปิดดูเสมอ
 * และเนื้อหามี IP/User-Agent ซึ่งไม่ควรถูกแคชร่วมกับคำขออื่น
 *
 * ⚠️ **ไม่มีฟังก์ชันเขียน** — audit log อ่านอย่างเดียวโดยเจตนา
 */

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}

export function fetchAdminLogsOnServer(params: URLSearchParams): Promise<AdminLogListResult> {
  return apiFetchAsUser<AdminLogListResult>(withQuery("/api/admin/logs", params), {
    cache: "no-store",
  });
}

export function fetchAdminLogFiltersOnServer(params: URLSearchParams): Promise<AdminLogFilters> {
  return apiFetchAsUser<AdminLogFilters>(withQuery("/api/admin/logs/filters", params), {
    cache: "no-store",
  });
}

/** ประวัติทั้งหมดของของชิ้นเดียว — ใช้บนหน้ารายละเอียดของสินค้า/คำสั่งซื้อ/ลูกค้า */
export function fetchTargetHistoryOnServer(
  targetType: LogTargetType,
  targetId: string,
): Promise<TargetHistoryResult> {
  return apiFetchAsUser<TargetHistoryResult>(
    `/api/admin/logs/target/${targetType}/${encodeURIComponent(targetId)}`,
    { cache: "no-store" },
  );
}
