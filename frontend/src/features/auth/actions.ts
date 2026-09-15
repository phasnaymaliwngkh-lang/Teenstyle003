"use server";

import { signIn, signOut } from "@/lib/auth";

/**
 * Server Action สำหรับเข้า/ออกจากระบบ
 *
 * ใช้ Server Action แทน next-auth/react เพื่อไม่ต้องส่ง SessionProvider
 * และ JavaScript ของ auth ไปฝั่ง client — ปุ่มยังทำงานได้แม้ JS ยังโหลดไม่เสร็จ
 */

/** path ที่อนุญาตให้ redirect กลับได้ — กัน open redirect ไปโดเมนอื่น */
function safeCallbackUrl(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/after-signin";
  // ต้องเป็น path ภายในเว็บเท่านั้น ห้าม //evil.com หรือ http://evil.com
  if (!value.startsWith("/") || value.startsWith("//")) return "/after-signin";
  return value;
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  await signIn("google", { redirectTo: safeCallbackUrl(formData.get("callbackUrl")) });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
