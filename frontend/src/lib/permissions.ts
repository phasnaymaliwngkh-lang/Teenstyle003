/**
 * บทบาทและสิทธิ์ — ต้องตรงกับที่ seed ไว้ใน database/seed/data.ts
 *
 * ไฟล์นี้ import ได้ทั้งฝั่ง client และ server (ไม่มีอะไรที่เป็นความลับ)
 * การตรวจสิทธิ์ "จริง" ต้องเกิดฝั่ง server เท่านั้น — ดู src/lib/dal.ts และ backend middleware
 * ค่าที่ใช้ฝั่ง client มีไว้เพื่อ "ซ่อน/แสดงปุ่ม" ไม่ใช่เพื่อความปลอดภัย
 */

export const ROLES = ["CUSTOMER", "EMPLOYEE", "ADMIN", "SUPER_ADMIN"] as const;

export type RoleName = (typeof ROLES)[number];

/** บทบาทที่เข้าหลังบ้านได้ */
export const STAFF_ROLES: readonly RoleName[] = ["EMPLOYEE", "ADMIN", "SUPER_ADMIN"];

export function isStaffRole(role: string | undefined | null): boolean {
  return role != null && STAFF_ROLES.includes(role as RoleName);
}

/** หน้าแรกหลังเข้าสู่ระบบ ตามที่ STEP 3 กำหนด */
export function landingPathForRole(role: string | undefined | null): string {
  return isStaffRole(role) ? "/admin" : "/account";
}
