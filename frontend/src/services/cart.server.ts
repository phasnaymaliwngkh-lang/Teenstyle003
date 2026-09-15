import "server-only";

import { apiFetchAsCartOwner } from "@/lib/api-server";
import type { Cart, MergeCartResult } from "@/types/catalog";

/**
 * อ่าน/รวมตะกร้าจากฝั่ง server (STEP 9)
 *
 * ใช้กับ Server Component (หน้า /cart, ตัวเลขบน navbar) และ `/after-signin`
 * ที่ต้องส่งต่อทั้ง session token และ cookie ของตะกร้า guest ไปให้ backend
 */

export function fetchCartOnServer(): Promise<Cart> {
  return apiFetchAsCartOwner<Cart>("/api/cart");
}

/**
 * รวมตะกร้าของ guest เข้าบัญชีหลังล็อกอิน
 *
 * เรียกซ้ำได้ไม่มีผลข้างเคียง (backend ลบตะกร้า guest ทิ้งหลังรวมเสร็จ)
 * ต้องส่ง Origin ไปด้วยเพราะ backend ตรวจ origin ของคำขอที่เปลี่ยนข้อมูล (กัน CSRF)
 */
export function mergeCartOnServer(origin: string): Promise<MergeCartResult> {
  return apiFetchAsCartOwner<MergeCartResult>("/api/cart/merge", {
    method: "POST",
    headers: { Origin: origin },
  });
}
