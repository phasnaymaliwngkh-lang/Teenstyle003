import "server-only";

import { cookies } from "next/headers";

import { apiFetch, type ApiRequestOptions } from "./api";

/**
 * เรียก backend API "ในนามผู้ใช้ที่ล็อกอินอยู่" — ใช้ได้เฉพาะฝั่ง server
 *
 * ทำไมต้องมีไฟล์นี้แยกจาก api.ts:
 *   session cookie ของ Auth.js เป็น httpOnly ดังนั้น JavaScript ฝั่ง client อ่านไม่ได้ (ซึ่งถูกต้อง)
 *   ตอน dev เบราว์เซอร์ส่ง cookie ไป localhost:4000 ให้เองเพราะ cookie ไม่แยกตาม port
 *   แต่ตอน production frontend กับ backend อยู่ต่างโดเมน cookie จะไม่ถูกส่งไป
 *   จึงต้องให้ Server Component อ่าน cookie แล้วส่งต่อเป็น Authorization: Bearer
 *
 * สรุป: ถ้า API ต้องล็อกอิน → เรียกจาก Server Component ด้วยฟังก์ชันนี้
 *       ห้ามเรียกจาก client component ตรง ๆ
 */

const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();

  for (const name of SESSION_COOKIE_NAMES) {
    const value = jar.get(name)?.value;
    if (value) return value;
  }

  return null;
}

export async function apiFetchAsUser<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const token = await readSessionToken();

  return apiFetch<TData>(path, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** ชื่อ cookie ของตะกร้า guest — ต้องตรงกับ backend (cart.controller.ts) */
export const CART_COOKIE = "cart-token";

/**
 * เรียก backend "ในนามเจ้าของตะกร้าใบนี้" — ใช้ได้เฉพาะฝั่ง server (STEP 9)
 *
 * ตะกร้าเป็นของได้ 2 แบบ จึงต้องส่งต่อทั้งคู่:
 *   - ผู้ใช้ที่ล็อกอิน → session token เป็น `Authorization: Bearer`
 *   - guest → cookie `cart-token` ส่งต่อเป็น header `Cookie`
 *     (production คนละโดเมน เบราว์เซอร์จะไม่ส่ง cookie ไป backend ให้เอง)
 *
 * ⚠️ ส่งต่อเฉพาะ cookie ของตะกร้า ไม่ส่ง cookie อื่นทั้งก้อน
 */
export async function apiFetchAsCartOwner<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const token = await readSessionToken();
  const jar = await cookies();
  const cartToken = jar.get(CART_COOKIE)?.value;

  return apiFetch<TData>(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cartToken ? { Cookie: `${CART_COOKIE}=${cartToken}` } : {}),
    },
  });
}
