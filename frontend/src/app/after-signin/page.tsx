import { redirect } from "next/navigation";

import { requireUser } from "@/lib/dal";
import { landingPathForRole } from "@/lib/permissions";

/**
 * หน้าตัวกลางหลังเข้าสู่ระบบสำเร็จ — ส่งผู้ใช้ไปหน้าที่ตรงกับบทบาท (STEP 3)
 *
 *   CUSTOMER                        → /account
 *   EMPLOYEE / ADMIN / SUPER_ADMIN  → /admin
 *
 * แยกเป็นหน้าเดียวเพราะตอนกด signIn เรายังไม่รู้บทบาท (ยังไม่มี session)
 * และ proxy.ts ก็อ่านฐานข้อมูลไม่ได้
 *
 * STEP 9: ส่งต่อผ่าน `/api/cart/merge` ก่อน เพื่อรวมตะกร้าของ guest เข้าบัญชี
 * แล้วค่อยไปหน้าปลายทาง (route handler เป็นที่เดียวที่ลบ cookie ของ guest ได้)
 */
export default async function AfterSignInPage() {
  const session = await requireUser();
  const landing = landingPathForRole(session.user.role);

  redirect(`/api/cart/merge?next=${encodeURIComponent(landing)}`);
}
