import { Bell } from "lucide-react";
import Link from "next/link";

import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchStockAlertsOnServer } from "@/services/admin.server";

/**
 * ป้ายแจ้งเตือนบนแถบหลังบ้าน (STEP 16)
 *
 * ⚠️ ตัวเลขคือ "การแจ้งเตือนที่ยังไม่มีใครรับทราบ" — ถ้าอ่านค่าไม่ได้ (API ล่ม)
 *    จะแสดงกระดิ่งเปล่า ๆ **ไม่ใส่ 0 หรือเลขสมมติ** เพราะ 0 หมายถึง "ไม่มีปัญหา"
 *    ซึ่งเป็นการโกหกเมื่อความจริงคือ "ยังไม่รู้"
 * ⚠️ แสดงเฉพาะคนที่มีสิทธิ์ดูคลัง เพื่อไม่ยิง API ที่จะได้ 403 กลับมา
 */
export async function AlertBell() {
  const session = await getSession();

  if (session === null || !session.user.permissions.includes("inventory:read")) {
    return null;
  }

  let count: number | null = null;

  try {
    const data = await fetchStockAlertsOnServer(new URLSearchParams());
    count = data.summary.unacknowledged;
  } catch (error) {
    // แจ้งเตือนเป็นข้อมูลเสริม — พังแล้วต้องไม่ทำให้ทั้งแถบหลังบ้านพัง
    if (!(error instanceof ApiClientError)) throw error;
  }

  // แยกตัวแปรไว้ให้ TypeScript แคบชนิดได้ (count เป็น null ได้เมื่ออ่าน API ไม่สำเร็จ)
  const unacknowledged = count !== null && count > 0 ? count : null;

  return (
    <Link
      href="/admin/alerts"
      aria-label={
        count === null
          ? "แจ้งเตือนสต็อก (อ่านจำนวนไม่ได้)"
          : `แจ้งเตือนสต็อก ${count} รายการที่ยังไม่รับทราบ`
      }
      className="relative flex size-11 items-center justify-center rounded-full border border-line transition hover:border-brand-soft hover:bg-lilac-50"
    >
      <Bell className="size-5" aria-hidden />

      {unacknowledged !== null && (
        <span className="absolute -top-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
          {unacknowledged > 99 ? "99+" : unacknowledged}
        </span>
      )}
    </Link>
  );
}
