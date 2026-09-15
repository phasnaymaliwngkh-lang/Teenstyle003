import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/dal";
import { CART_COOKIE } from "@/lib/api-server";
import { mergeCartOnServer } from "@/services/cart.server";

/**
 * รวมตะกร้าของ guest เข้าบัญชีหลังล็อกอิน แล้วพาไปหน้าถัดไป (STEP 9)
 *
 * ทำไมต้องเป็น Route Handler ไม่ใช่หน้าธรรมดา
 *   หลังรวมเสร็จต้อง **ลบ cookie `cart-token` ของเบราว์เซอร์** ทิ้ง
 *   ซึ่ง Next อนุญาตให้แก้ cookie ได้เฉพาะใน Route Handler หรือ Server Action
 *   (ถ้าปล่อยไว้ เบราว์เซอร์จะถือ token ที่ชี้ไปตะกร้าที่ถูกลบแล้ว)
 *
 * เรียกซ้ำได้ไม่มีผลข้างเคียง — backend ลบตะกร้า guest หลังรวมสำเร็จแล้ว
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();

  // กัน open redirect: รับเฉพาะ path ภายในเว็บเรา
  const requested = request.nextUrl.searchParams.get("next") ?? "/";
  const target = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  const destination = new URL(target, request.nextUrl.origin);

  if (!session) {
    // ยังไม่ล็อกอิน → ไม่มีอะไรต้องรวม
    return NextResponse.redirect(destination);
  }

  const jar = await cookies();
  const hadGuestCart = jar.get(CART_COOKIE)?.value !== undefined;

  try {
    await mergeCartOnServer(request.nextUrl.origin);
  } catch {
    // รวมไม่สำเร็จไม่ควรขัดขวางการเข้าสู่ระบบ — ของใน localStorage ไม่มี ตะกร้าอยู่ในฐานข้อมูลอยู่แล้ว
    // ผู้ใช้ยังเห็นตะกร้าของบัญชีตัวเองได้ปกติ และลองรวมใหม่ได้ครั้งหน้าที่ล็อกอิน
    return NextResponse.redirect(destination);
  }

  const response = NextResponse.redirect(destination);

  if (hadGuestCart) {
    // ตะกร้า guest ถูกรวมและลบไปแล้ว — เอา cookie ออกจากเบราว์เซอร์ด้วย
    response.cookies.delete(CART_COOKIE);
  }

  return response;
}
