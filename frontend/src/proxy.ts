import { NextResponse, type NextRequest } from "next/server";

import { apiOriginOf, buildCsp } from "./lib/csp";

/**
 * Proxy (Next.js 16 เปลี่ยนชื่อมาจาก middleware.ts — ความสามารถเหมือนเดิม)
 *
 * ⚠️ ที่นี่ทำได้แค่ **optimistic check**: ดูว่ามี session cookie อยู่ไหมเท่านั้น
 *    ห้ามยิงฐานข้อมูล เพราะ proxy รันทุก request รวมถึง prefetch ของ <Link>
 *    การตรวจสิทธิ์จริงอยู่ที่ src/lib/dal.ts (layout/page) และที่ backend
 *    → cookie ปลอมจะผ่าน proxy ได้ แต่จะตกที่ DAL เสมอ
 *
 * หน้าที่ของไฟล์นี้มีแค่ 3 อย่าง
 *   1. ใส่ header x-pathname ให้ server component รู้ path ปัจจุบัน (ใช้ทำ callbackUrl)
 *   2. เด้งผู้ที่ยังไม่ล็อกอินออกจากหน้าที่ต้องล็อกอิน (ลดการโหลดหน้าที่จะ redirect อยู่ดี)
 *   3. ออก nonce ใหม่ทุกคำขอ + ส่ง Content-Security-Policy (STEP 28)
 *
 * ส่วนการเด้ง "คนที่ล็อกอินแล้ว" ออกจาก /signin ทำที่หน้า /signin เอง — ดูเหตุผลด้านล่าง
 */

/** ขึ้นต้นด้วย path เหล่านี้ = ต้องล็อกอิน */
const PROTECTED_PREFIXES = ["/account", "/admin"];

/** ชื่อ cookie ของ Auth.js v5 — ต่างกันระหว่าง dev กับ production (secure prefix) */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => {
    const value = request.cookies.get(name)?.value;
    return typeof value === "string" && value.length > 0;
  });
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  /**
   * nonce ใหม่ทุกคำขอ — ใช้ซ้ำไม่ได้ ไม่งั้นผู้โจมตีที่รู้ค่าเดิมแปะ nonce เองได้
   * ส่ง CSP ไปทั้งใน request header (Next อ่านไปแปะให้สคริปต์ของตัวเอง)
   * และ response header (เบราว์เซอร์บังคับใช้)
   */
  const nonce = crypto.randomUUID();
  const csp = buildCsp(nonce, {
    isDev: process.env.NODE_ENV !== "production",
    apiOrigin: apiOriginOf(process.env.NEXT_PUBLIC_API_URL),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  /** ใส่ CSP ลง response ทุกเส้นทางที่ proxy ดูแล */
  const withSecurityHeaders = (response: NextResponse): NextResponse => {
    response.headers.set("content-security-policy", csp);
    return response;
  };

  const signedIn = hasSessionCookie(request);
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !signedIn) {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(signInUrl));
  }

  /**
   * ⚠️ ตั้งใจไม่ redirect ออกจาก /signin ที่นี่
   *
   * เคยทำแล้วเกิด redirect loop: ถ้า cookie ยังอยู่แต่แถวใน Session ถูกลบ
   * (ถูกเพิกถอน / หมดอายุ / ฐานข้อมูลถูก reset) proxy จะเห็นว่า "ล็อกอินแล้ว"
   * แล้วเด้งไป /after-signin ซึ่งตรวจจริงแล้วพบว่าไม่มี session จึงเด้งกลับ /signin วนไม่จบ
   *
   * การเด้งออกจาก /signin ตอนล็อกอินแล้วจึงทำที่ตัวหน้า /signin เอง
   * เพราะที่นั่นอ่านฐานข้อมูลได้ และรู้บทบาทจริงเพื่อส่งไปหน้าที่ถูกต้องได้เลย
   */

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  /**
   * ไม่ให้ proxy รันกับ /api (รวม /api/auth ของ Auth.js), ไฟล์ static และรูปภาพ
   * เพื่อไม่ให้ไปขัดขวาง OAuth callback และไม่เสียเวลากับไฟล์ที่ไม่ต้องตรวจ
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
