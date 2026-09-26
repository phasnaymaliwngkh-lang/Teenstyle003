import type { Metadata } from "next";
import { Store } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { AlertBell } from "@/features/admin/components/alert-bell";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { requireStaff } from "@/lib/dal";
import { NOINDEX_NOFOLLOW } from "@/lib/seo";

/**
 * ทุกหน้าใต้ /admin ต้องไม่ขึ้นดัชนี — ประกาศที่ layout ที่เดียว (STEP 33)
 *
 * ทำไมต้องอยู่ที่นี่: /admin/knowledge และ /admin/support เป็น client component
 * ซึ่ง **export metadata ไม่ได้** ตอนตรวจจึงพบว่าสองหน้านั้นไม่มี noindex เลย
 * (หน้าอื่นใส่ไว้เองทีละหน้า — ซึ่งเป็นวิธีที่ลืมได้ทุกครั้งที่เพิ่มหน้าใหม่)
 * ประกาศที่ layout แล้วหน้าย่อยจะสืบทอดไปเอง และหน้าไหนจะทับด้วยค่าของตัวเองก็ยังได้
 */
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW };

/**
 * Layout ของระบบหลังบ้าน (STEP 4 — โครงเบื้องต้น)
 *
 * ตรวจสิทธิ์ที่ layout ด้วย เพื่อให้ทุกหน้าใต้ /admin ถูกป้องกันโดยปริยาย
 * ไม่ต้องพึ่งให้แต่ละหน้าจำใส่เอง (แต่ละหน้ายังตรวจสิทธิ์เฉพาะของตัวเองเพิ่มได้)
 *
 * STEP 13 จะเปลี่ยนแถบด้านบนนี้เป็น sidebar เต็มรูปแบบ
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  // ป้องกันทุกหน้าใต้ /admin ที่ชั้นนี้ — หน้าย่อยไม่ต้องจำใส่เอง
  await requireStaff();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur-xl">
        {/**
         * ⚠️ แถบนี้เคยล้นที่จอ 360px แล้ว flex ย่อของทุกชิ้นให้พอดี (STEP 31)
         *    ผลคือกระดิ่งเหลือกว้าง 29px (จาก 44) · โลโก้ตัดเป็นสองบรรทัด ·
         *    ปุ่มออกจากระบบสูง 62px เพราะข้อความขึ้นบรรทัดใหม่
         *    **หน้าไม่ได้เลื่อนแนวนอน จึงไม่มีอะไรฟ้อง** — การย่อของ flex ซ่อนปัญหาไว้
         *    → ทุกชิ้นต้อง `shrink-0` และบนจอเล็กเหลือเฉพาะไอคอน
         */}
        <div className="mx-auto flex h-[64px] w-full max-w-[1200px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link href="/admin" className="flex shrink-0 items-center text-lg font-extrabold">
            <span className="hidden sm:inline">
              TeenStyle
              <span className="text-brand-gradient" aria-hidden>
                {" "}
                ✧
              </span>
            </span>
            <span className="rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-xs font-bold text-brand-dark sm:ml-2">
              ADMIN
            </span>
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* ป้ายแจ้งเตือนยิง API เอง — ห่อ Suspense ไว้เพื่อไม่ให้ถ่วงการแสดงแถบทั้งแถบ */}
            <Suspense fallback={<div className="size-11 shrink-0" aria-hidden />}>
              <AlertBell />
            </Suspense>
            <Link
              href="/"
              aria-label="ไปหน้าร้าน"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] border border-line text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 sm:px-4"
            >
              <Store className="size-5 sm:hidden" aria-hidden />
              <span className="hidden whitespace-nowrap sm:inline">ไปหน้าร้าน</span>
            </Link>
            <SignOutButton compactOnMobile />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
