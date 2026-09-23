"use server";

import { signIn, signOut } from "@/lib/auth";
import { safeInternalPath } from "@/lib/safe-redirect";

/**
 * Server Action สำหรับเข้า/ออกจากระบบ
 *
 * ใช้ Server Action แทน next-auth/react เพื่อไม่ต้องส่ง SessionProvider
 * และ JavaScript ของ auth ไปฝั่ง client — ปุ่มยังทำงานได้แม้ JS ยังโหลดไม่เสร็จ
 */

export async function signInWithGoogle(formData: FormData): Promise<void> {
  /**
   * ⚠️ ต้องผ่าน `safeInternalPath` เสมอ — `callbackUrl` มาจาก query string ของลิงก์
   *    ที่ใครก็ส่งให้เหยื่อได้ · ด่านเดิมที่เช็คแค่ `startsWith("/")` ถูก `/\evil.com` เจาะได้
   *    (ดูรายละเอียดใน lib/safe-redirect.ts)
   */
  await signIn("google", {
    redirectTo: safeInternalPath(formData.get("callbackUrl"), "/after-signin"),
  });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
