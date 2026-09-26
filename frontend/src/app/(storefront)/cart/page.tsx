import { ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { CartItemRow } from "@/features/cart/components/cart-item-row";
import { CartSummaryCard } from "@/features/cart/components/cart-summary-card";
import { ClearCartButton } from "@/features/cart/components/clear-cart-button";
import { ApiClientError } from "@/lib/api";
import { fetchCartOnServer } from "@/services/cart.server";
import type { Cart } from "@/types/catalog";
import { NOINDEX_FOLLOW } from "@/lib/seo";

export const metadata: Metadata = {
  title: "ตะกร้าสินค้า",
  description: "ตรวจรายการสินค้าในตะกร้า แก้จำนวน และดูยอดรวมก่อนสั่งซื้อ",
  robots: NOINDEX_FOLLOW,
};

/**
 * หน้าตะกร้า /cart (STEP 9)
 *
 * - อ่านตะกร้าจาก backend ฝั่ง server ทุกครั้งที่โหลด (`cache: "no-store"`)
 *   จึงเห็นราคาและสต็อกล่าสุดเสมอ ไม่ใช่ของที่ cache ไว้
 * - ใช้ได้ทั้งตอนล็อกอินและยังไม่ล็อกอิน (guest ใช้ cookie `cart-token`)
 * - ยอดเงินทุกบรรทัดคำนวณที่ server — หน้าเว็บแค่แสดงผล
 *
 * ⚠️ ไม่ห่อ <Suspense> ที่ระดับหน้าเพราะตะกร้าเป็นเนื้อหาหลักของหน้านี้ทั้งหมด
 *    (ถ้ามีส่วนที่ stream ได้ในอนาคต เช่น "สินค้าที่คุณอาจชอบ" ให้ใส่ Suspense เฉพาะส่วนนั้น)
 */
export default async function CartPage() {
  let cart: Cart | null = null;
  let errorMessage: string | null = null;

  try {
    cart = await fetchCartOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดตะกร้าไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
            Cart
          </span>
          <h1 className="mt-3 text-3xl sm:text-4xl">ตะกร้าสินค้า</h1>
          {cart !== null && cart.items.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              {cart.summary.itemCount} รายการ · {cart.summary.totalQuantity} ชิ้น ·
              ติ๊กเลือกรายการที่ต้องการสั่งซื้อ
            </p>
          )}
        </div>

        {cart !== null && cart.items.length > 0 && <ClearCartButton />}
      </header>

      <div className="mt-8">
        {errorMessage !== null ? (
          <SectionError message={errorMessage} />
        ) : cart === null ? null : cart.items.length === 0 ? (
          <EmptyCart />
        ) : (
          /* min-w-0 ที่ลูกของ grid สำคัญ: ไม่มีแล้ว track จะกว้างตาม min-content ของแถวสินค้า
             แล้วดันทั้งหน้าให้เลื่อนแนวนอนที่จอ 360px (STEP 31) */
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <ul className="min-w-0 space-y-4">
              {cart.items.map((item) => (
                <CartItemRow key={item.id} item={item} />
              ))}
            </ul>

            <CartSummaryCard summary={cart.summary} isGuest={cart.isGuest} />
          </div>
        )}
      </div>
    </main>
  );
}

/** ตะกร้าว่าง — ไม่ใช่ข้อผิดพลาด จึงไม่มีปุ่มลองใหม่ แต่ให้ทางไปต่อ */
function EmptyCart() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-16 text-center">
      <ShoppingBag className="mx-auto size-12 text-brand-soft" aria-hidden />
      <p className="mt-4 text-lg font-extrabold">ยังไม่มีสินค้าในตะกร้า</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        เลือกสินค้าจากหน้าร้าน หรือเริ่มจากไอเดียการแต่งตัวที่จัดชุดไว้แล้ว
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/shop"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          เลือกซื้อสินค้า
        </Link>
        <Link
          href="/looks"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ดูไอเดียการแต่งตัว
        </Link>
      </div>
    </div>
  );
}
