import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getSession } from "@/lib/dal";
import { landingPathForRole } from "@/lib/permissions";
import { NOINDEX_NOFOLLOW } from "@/lib/seo";

export const metadata: Metadata = {
  title: "ไม่มีสิทธิ์เข้าถึง",
  robots: NOINDEX_NOFOLLOW,
};

/**
 * หน้า 403 Forbidden (STEP 3)
 * ใช้เมื่อ "ล็อกอินแล้ว แต่บทบาทไม่มีสิทธิ์" — ต่างจาก /unauthorized ที่คือยังไม่ได้ล็อกอิน
 */
export default async function ForbiddenPage() {
  const session = await getSession();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 shadow-[var(--shadow-lift)]">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-danger/10">
            <ShieldX className="size-8 text-danger" aria-hidden />
          </div>

          <h1 className="mt-6 text-2xl">ไม่มีสิทธิ์เข้าถึง</h1>
          <p className="mt-3 text-sm text-muted">
            บัญชีของคุณเข้าสู่ระบบแล้ว แต่บทบาทปัจจุบันไม่ได้รับอนุญาตให้เข้าหน้านี้
          </p>

          {session && (
            <p className="mt-4 rounded-2xl bg-lilac-50 px-4 py-3 text-sm">
              เข้าสู่ระบบเป็น <strong>{session.user.email}</strong>
              <br />
              บทบาท <strong className="text-brand-dark">{session.user.role}</strong>
            </p>
          )}

          <p className="mt-4 text-xs text-muted-light">
            ถ้าคิดว่าควรมีสิทธิ์ ให้ผู้ดูแลระบบเปลี่ยนบทบาทของบัญชีนี้ในฐานข้อมูล
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href={landingPathForRole(session?.user.role)}
              className="btn-brand flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] px-6 font-bold transition"
            >
              กลับไปหน้าของฉัน
            </Link>
            <Link
              href="/"
              className="flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] border border-line px-6 font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              หน้าแรก
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
