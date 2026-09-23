import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { cache } from "react";

import { auth } from "./auth";
import { isStaffRole, type RoleName } from "./permissions";
import { safeInternalPath } from "./safe-redirect";

/**
 * Data Access Layer — จุดเดียวที่ใช้ตรวจ session และสิทธิ์ในฝั่ง server ของ Next.js
 *
 * ทำไมต้องมีชั้นนี้ (ตามคำแนะนำของ Next.js เอง):
 *   proxy.ts ทำได้แค่ "optimistic check" คือดูว่ามี cookie ไหม เพราะมันรันทุก request
 *   รวมถึง prefetch จึงห้ามยิงฐานข้อมูล → **ห้ามใช้ proxy เป็นด่านเดียว**
 *   การตรวจจริงต้องอยู่ใกล้ข้อมูลที่สุด คือใน layout / page / server action ผ่านไฟล์นี้
 *
 * `cache()` ทำให้เรียกซ้ำใน render เดียวกันไม่ยิงฐานข้อมูลหลายครั้ง
 */

/** อ่าน session ปัจจุบัน — คืน null ถ้าไม่ได้ล็อกอินหรือบัญชีถูกระงับ */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth();

  if (!session?.user?.id) return null;

  // session ที่ค้างอยู่ของบัญชีที่ถูกระงับต้องใช้ต่อไม่ได้
  if (session.user.status !== "ACTIVE") return null;

  return session;
});

/**
 * path ที่ผู้ใช้กำลังเปิด — proxy.ts ใส่ไว้ใน header ให้ (ใช้ทำ callbackUrl)
 *
 * ⚠️ proxy เขียนทับค่าที่ client ส่งมาเสมอ (`headers.set`) แต่ proxy ไม่ได้รันทุกเส้นทาง
 *    (matcher ข้าม /api และไฟล์ static) — เส้นทางเหล่านั้น client ตั้ง `x-pathname` เองได้
 *    จึงกรองผ่าน `safeInternalPath` ที่ต้นทางด้วย ไม่รอไปกรองที่ปลายทางเท่านั้น
 */
async function currentPath(): Promise<string> {
  const headerList = await headers();
  return safeInternalPath(headerList.get("x-pathname"), "/");
}

/** ต้องล็อกอิน — ถ้าไม่ ส่งไปหน้าเข้าสู่ระบบพร้อมจำ path เดิมไว้ */
export async function requireUser(): Promise<Session> {
  const session = await getSession();

  if (!session) {
    const from = await currentPath();
    redirect(`/signin?callbackUrl=${encodeURIComponent(from)}`);
  }

  return session;
}

/** ต้องมีบทบาทใดบทบาทหนึ่งในรายการ */
export async function requireRole(allowed: readonly RoleName[]): Promise<Session> {
  const session = await requireUser();

  if (!allowed.includes(session.user.role)) {
    redirect("/forbidden");
  }

  return session;
}

/** ต้องเป็นพนักงานขึ้นไป (EMPLOYEE / ADMIN / SUPER_ADMIN) — ใช้กับ /admin */
export async function requireStaff(): Promise<Session> {
  const session = await requireUser();

  if (!isStaffRole(session.user.role)) {
    redirect("/forbidden");
  }

  return session;
}

/** ต้องมีสิทธิ์ที่ระบุ เช่น "product:create" */
export async function requirePermission(permissionKey: string): Promise<Session> {
  const session = await requireUser();

  if (!session.user.permissions.includes(permissionKey)) {
    redirect("/forbidden");
  }

  return session;
}

/** ตรวจสิทธิ์แบบไม่ redirect — ใช้ตัดสินใจว่าจะแสดงปุ่มไหม */
export function hasPermission(session: Session | null, permissionKey: string): boolean {
  return session?.user.permissions.includes(permissionKey) ?? false;
}
