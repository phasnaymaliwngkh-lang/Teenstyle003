import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { fetchCartOnServer } from "@/services/cart.server";

/**
 * ไอคอนตะกร้าพร้อมจำนวนชิ้น (STEP 9)
 *
 * แยกเป็นคอมโพเนนต์ของตัวเองเพื่อห่อด้วย <Suspense> ใน navbar ได้
 * ถ้าอ่านตะกร้าไม่สำเร็จ (backend ล่ม) ยังต้องแสดงไอคอนให้กดไปหน้าตะกร้าได้
 * — ตัวเลขหายไปเฉย ๆ ดีกว่าทำให้ navbar ทั้งแถบพัง
 */
export async function CartBadge() {
  let count = 0;

  try {
    const cart = await fetchCartOnServer();
    count = cart.summary.totalQuantity;
  } catch {
    count = 0;
  }

  return <CartIcon count={count} />;
}

/** โครงระหว่างรอ (และตอนอ่านไม่ได้) — ไม่มีตัวเลข */
export function CartIcon({ count = 0 }: { count?: number }) {
  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `ตะกร้าสินค้า — ${count} ชิ้น` : "ตะกร้าสินค้า"}
      title="ตะกร้าสินค้า"
      className="relative grid size-11 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac hover:text-brand-dark"
    >
      <ShoppingBag className="size-5" aria-hidden />

      {count > 0 && (
        <span
          aria-hidden
          className="absolute top-1 right-0.5 grid min-w-5 place-items-center rounded-[var(--radius-pill)] bg-brand px-1 text-[11px] font-bold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
