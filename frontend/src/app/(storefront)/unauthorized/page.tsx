import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NOINDEX_NOFOLLOW } from "@/lib/seo";

export const metadata: Metadata = {
  title: "ต้องเข้าสู่ระบบก่อน",
  robots: NOINDEX_NOFOLLOW,
};

/**
 * หน้า 401 Unauthorized (STEP 3)
 * ใช้เมื่อ "ยังไม่ได้ล็อกอิน" — ต่างจาก /forbidden ที่ล็อกอินแล้วแต่ไม่มีสิทธิ์
 */
export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const signInHref = params.callbackUrl
    ? `/signin?callbackUrl=${encodeURIComponent(params.callbackUrl)}`
    : "/signin";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 shadow-[var(--shadow-lift)]">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-lilac">
            <LockKeyhole className="size-8 text-brand" aria-hidden />
          </div>

          <h1 className="mt-6 text-2xl">ต้องเข้าสู่ระบบก่อน</h1>
          <p className="mt-3 text-sm text-muted">
            หน้านี้สงวนไว้สำหรับสมาชิก กรุณาเข้าสู่ระบบด้วยบัญชี Google ของคุณ
          </p>

          <div className="mt-6 flex flex-col gap-3">
            <Link
              href={signInHref}
              className="btn-brand flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] px-6 font-bold transition"
            >
              เข้าสู่ระบบ
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
