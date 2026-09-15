import Link from "next/link";
import { Suspense } from "react";

import { AlertBell } from "@/features/admin/components/alert-bell";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { requireStaff } from "@/lib/dal";

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
        <div className="mx-auto flex h-[64px] w-full max-w-[1200px] items-center gap-4 px-4 sm:px-6">
          <Link href="/admin" className="text-lg font-extrabold">
            TeenStyle
            <span className="text-brand-gradient" aria-hidden>
              {" "}
              ✧
            </span>
            <span className="ml-2 rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-xs font-bold text-brand-dark">
              ADMIN
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {/* ป้ายแจ้งเตือนยิง API เอง — ห่อ Suspense ไว้เพื่อไม่ให้ถ่วงการแสดงแถบทั้งแถบ */}
            <Suspense fallback={<div className="size-11" aria-hidden />}>
              <AlertBell />
            </Suspense>
            <Link
              href="/"
              className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              ไปหน้าร้าน
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
