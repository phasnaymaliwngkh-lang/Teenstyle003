import { apiFetch } from "@/lib/api";
import type { AppNotification } from "@/types/catalog";

/**
 * การแจ้งเตือน — ฝั่ง client (STEP 24)
 *
 * ⚠️ มีแค่ "ทำเครื่องหมายว่าอ่านแล้ว" — **ไม่มีทางสร้างหรือแก้เนื้อหาการแจ้งเตือนจาก client**
 *    เนื้อหาทุกบรรทัดเกิดจากเหตุการณ์จริงที่ฝั่ง server (สั่งซื้อ · ชำระเงิน · จัดส่ง · ราคาลด)
 */

export function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return apiFetch<AppNotification>(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH", cache: "no-store" },
  );
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/api/notifications/read-all", {
    method: "PATCH",
    cache: "no-store",
  });
}
