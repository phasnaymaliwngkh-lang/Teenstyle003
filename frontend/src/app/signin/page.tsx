import { AlertTriangle, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signInWithGoogle } from "@/features/auth/actions";
import { isAuthSecretConfigured, isGoogleConfigured } from "@/lib/auth";
import { getSession } from "@/lib/dal";
import { landingPathForRole } from "@/lib/permissions";
import { NOINDEX_FOLLOW } from "@/lib/seo";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
  description: "เข้าสู่ระบบ TEENSTYLE AI ด้วยบัญชี Google",
  robots: NOINDEX_FOLLOW,
};

/** ข้อความ error ที่ Auth.js ส่งกลับมาทาง query string */
const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "ตั้งค่าระบบเข้าสู่ระบบไม่ครบ — ตรวจ AUTH_SECRET และ GOOGLE_CLIENT_* ใน .env",
  AccessDenied: "บัญชีนี้ถูกระงับการใช้งาน หรือไม่ได้รับอนุญาตให้เข้าสู่ระบบ",
  Verification: "ลิงก์ยืนยันหมดอายุแล้ว กรุณาลองเข้าสู่ระบบอีกครั้ง",
  OAuthAccountNotLinked: "อีเมลนี้เคยสมัครด้วยวิธีอื่น กรุณาใช้วิธีเดิมที่เคยใช้",
  default: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
};

export default async function SignInPage({
  searchParams,
}: {
  // Next 16: searchParams เป็น Promise ต้อง await
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  /**
   * ตรวจ session จริงจากฐานข้อมูลที่นี่ (ไม่ใช่ใน proxy) แล้วเด้งไปหน้าตามบทบาท
   * proxy ดูได้แค่ว่ามี cookie ไหม ซึ่งอาจเป็น cookie ค้างที่ session ถูกลบไปแล้ว
   * ถ้าให้ proxy เด้งจะเกิด redirect loop กับ /after-signin
   */
  const existingSession = await getSession();
  if (existingSession) {
    redirect(landingPathForRole(existingSession.user.role));
  }

  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? "/after-signin";
  const error = params.error;
  const configured = isGoogleConfigured && isAuthSecretConfigured;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 shadow-[var(--shadow-lift)]">
          <div className="text-center">
            <Link href="/" className="text-2xl font-extrabold">
              TeenStyle <span className="text-brand-gradient">✧</span>
            </Link>
            <h1 className="mt-6 text-2xl">เข้าสู่ระบบ</h1>
            <p className="mt-2 text-sm text-muted">
              เข้าสู่ระบบเพื่อสะสมแต้ม ติดตามคำสั่งซื้อ และบันทึกลุคที่ถูกใจ
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-3"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              <p className="text-sm text-ink-soft">
                {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.default}
              </p>
            </div>
          )}

          {configured ? (
            <form action={signInWithGoogle} className="mt-8">
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <button
                type="submit"
                className="flex min-h-12 w-full items-center justify-center gap-3 rounded-[var(--radius-pill)] border border-line bg-white px-6 font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
              >
                <GoogleMark />
                เข้าสู่ระบบด้วย Google
              </button>
            </form>
          ) : (
            <div className="mt-8 rounded-2xl border border-warning/30 bg-warning/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold text-ink">ยังตั้งค่า Google OAuth ไม่ครบ</p>
                  <p className="mt-1 text-muted">
                    ต้องใส่ค่าเหล่านี้ในไฟล์ <code className="text-brand-dark">.env</code> ก่อน:
                  </p>
                  <ul className="mt-2 space-y-1 text-muted">
                    {!isAuthSecretConfigured && (
                      <li>
                        • <code className="text-brand-dark">AUTH_SECRET</code> — สร้างด้วย{" "}
                        <code className="text-brand-dark">npx auth secret</code>
                      </li>
                    )}
                    {!isGoogleConfigured && (
                      <li>
                        • <code className="text-brand-dark">GOOGLE_CLIENT_ID</code> และ{" "}
                        <code className="text-brand-dark">GOOGLE_CLIENT_SECRET</code>
                      </li>
                    )}
                  </ul>
                  <p className="mt-3 text-muted">
                    ขั้นตอนขอ credential อยู่ที่{" "}
                    <code className="text-brand-dark">docs/04-google-oauth-setup.md</code>
                  </p>
                </div>
              </div>
            </div>
          )}

          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-light">
            <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            เราขอเฉพาะชื่อ อีเมล และรูปโปรไฟล์จาก Google เท่าที่จำเป็นต่อการใช้งาน
            และไม่เก็บรหัสผ่านของคุณ
          </p>
        </div>

        <p className="mt-6 text-center text-sm">
          <Link href="/" className="text-muted transition hover:text-brand">
            ← กลับหน้าแรก
          </Link>
        </p>
      </div>
    </main>
  );
}

/** โลโก้ Google 4 สี (วาดเอง ไม่ได้คัดลอกไฟล์ asset มา) */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.6c-.1 1.1-.8 2.7-2.2 3.8l3.5 2.7c2.1-1.9 3.6-4.8 3.6-8.5z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.5-2.7c-1 .7-2.3 1.2-4.4 1.2-3.1 0-5.8-2.1-6.7-5l-3.6 2.8C3.7 21.3 7.6 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.6c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2L1.7 7.4C.9 8.8.5 10.4.5 12.4s.5 3.6 1.2 5l3.6-2.8z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c2.2 0 3.7.9 4.5 1.7l3.1-3C17.8 1.7 15.2.5 12 .5 7.6.5 3.7 3.2 1.7 7.4l3.6 2.8c.9-2.9 3.6-5.4 6.7-5.4z"
      />
    </svg>
  );
}
