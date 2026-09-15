import { getPrisma } from '@teenstyle/database';

/**
 * ตรวจ session ฝั่ง backend (STEP 3)
 *
 * backend อ่านตาราง `Session` ตัวเดียวกับที่ Auth.js (ฝั่ง Next.js) เขียนไว้
 * ข้อดีคือไม่ต้องแชร์ secret หรือถอดรหัส JWT ของ Auth.js เอง
 * และเมื่อ admin ระงับบัญชี session ที่ค้างอยู่จะใช้ต่อไม่ได้ทันที
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** key ของสิทธิ์ เช่น "product:create" */
  permissions: string[];
  status: string;
}

/**
 * แลก session token เป็นข้อมูลผู้ใช้ + สิทธิ์
 * คืน null ทุกกรณีที่ใช้ไม่ได้ (ไม่พบ / หมดอายุ / ถูกระงับ / ถูกลบ)
 * เพื่อไม่ให้ผู้เรียกเผลอแยกแยะสาเหตุแล้วรั่วข้อมูลออกไป
 */
export async function findUserBySessionToken(token: string): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const session = await getPrisma().session.findUnique({
    where: { sessionToken: token },
    select: {
      expires: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
          role: {
            select: {
              name: true,
              permissions: { select: { key: true } },
            },
          },
        },
      },
    },
  });

  if (!session) return null;
  if (session.expires.getTime() <= Date.now()) return null;

  const { user } = session;
  if (user.deletedAt !== null) return null;
  if (user.status !== 'ACTIVE') return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.name,
    permissions: user.role.permissions.map((permission) => permission.key),
    status: user.status,
  };
}

/** ลบ session ที่หมดอายุแล้ว — จะถูกเรียกจาก background job ใน STEP 52 */
export async function deleteExpiredSessions(): Promise<number> {
  const result = await getPrisma().session.deleteMany({
    where: { expires: { lte: new Date() } },
  });

  return result.count;
}
