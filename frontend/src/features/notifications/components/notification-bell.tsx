import { Bell } from "lucide-react";
import Link from "next/link";

import { fetchUnreadCountOnServer } from "@/services/notification.server";

/**
 * กระดิ่งแจ้งเตือนบน navbar (STEP 24)
 *
 * ⚠️ อ่านจำนวนไม่ได้ → แสดงกระดิ่งเปล่า **ห้ามใส่ 0**
 *    เพราะ 0 หมายถึง "ไม่มีอะไรใหม่" ซึ่งเป็นการโกหกเมื่อความจริงคือ "ยังไม่รู้"
 *    (กฎเดียวกับป้ายกระดิ่งหลังบ้านของ STEP 16 ข้อ 8)
 *
 * ⚠️ ห่อด้วย `<Suspense>` ใน navbar เสมอ — navbar อยู่ทุกหน้า
 *    ถ้าปล่อยให้รอ API นี้ ทุกหน้าในเว็บจะช้าตามไปด้วย
 */
export async function NotificationBell() {
  const unreadCount = await fetchUnreadCountOnServer();
  const badge = unreadCount !== null && unreadCount > 0 ? unreadCount : null;

  return (
    <Link
      href="/account/notifications"
      aria-label={
        unreadCount === null
          ? "การแจ้งเตือน (อ่านจำนวนไม่ได้)"
          : unreadCount === 0
            ? "การแจ้งเตือน — อ่านครบแล้ว"
            : `การแจ้งเตือน ${unreadCount} รายการที่ยังไม่อ่าน`
      }
      className="relative grid size-11 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac hover:text-brand-dark"
    >
      <Bell className="size-5" aria-hidden />

      {badge !== null && (
        <span className="absolute top-1 right-1 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

/** โครงระหว่างรอ — กระดิ่งเปล่าที่กดไปหน้าแจ้งเตือนได้เลย */
export function NotificationBellFallback() {
  return (
    <Link
      href="/account/notifications"
      aria-label="การแจ้งเตือน"
      className="grid size-11 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac hover:text-brand-dark"
    >
      <Bell className="size-5" aria-hidden />
    </Link>
  );
}
