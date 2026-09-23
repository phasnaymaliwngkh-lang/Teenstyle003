import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { NotificationListResult } from "@/types/catalog";

/**
 * อ่านการแจ้งเตือนจากฝั่ง server (STEP 24)
 *
 * `cache: "no-store"` เสมอ — เป็นข้อมูลส่วนตัวและเปลี่ยนตลอด ห้ามถูกแคชร่วมกับคนอื่น
 */
export function fetchNotificationsOnServer(
  params: URLSearchParams,
): Promise<NotificationListResult> {
  const qs = params.toString();

  return apiFetchAsUser<NotificationListResult>(`/api/notifications${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

/**
 * จำนวนที่ยังไม่อ่าน สำหรับกระดิ่งบน navbar
 *
 * ⚠️ อ่านไม่ได้ → คืน `null` ไม่ใช่ 0
 *    เพราะ 0 หมายถึง "ไม่มีอะไรใหม่" ซึ่งเป็นการโกหกเมื่อความจริงคือ "ยังไม่รู้"
 *    (กฎเดียวกับป้ายกระดิ่งหลังบ้านของ STEP 16 ข้อ 8)
 */
export async function fetchUnreadCountOnServer(): Promise<number | null> {
  try {
    const result = await apiFetchAsUser<{ unreadCount: number }>(
      "/api/notifications/unread-count",
      { cache: "no-store" },
    );

    return result.unreadCount;
  } catch {
    return null;
  }
}
