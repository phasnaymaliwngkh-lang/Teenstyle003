"use client";

import { Heart, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { addToWishlist, removeFromWishlist } from "@/services/wishlist.service";

export interface WishlistHeartProps {
  productId: string;
  productName: string;
  /** สถานะตอนเปิดหน้า — Server Component หามาให้แล้ว จึงไม่มีอาการหัวใจกะพริบสลับสถานะ */
  initialWishlisted: boolean;
  /** ผู้ใช้ล็อกอินอยู่ไหม — ยังไม่ล็อกอินให้พาไปหน้าเข้าสู่ระบบแทนที่จะกดแล้วเงียบ */
  isSignedIn: boolean;
}

/**
 * ปุ่มหัวใจสำหรับกดถูกใจสินค้า (STEP 22)
 *
 * ⚠️ รายการที่ถูกใจผูกกับบัญชีเสมอ (`Wishlist.userId` เป็น non-nullable)
 *    guest จึงกดไม่ได้ — พาไปหน้าเข้าสู่ระบบพร้อม `callbackUrl` กลับมาที่หน้าเดิม
 *    **ห้ามทำปุ่มที่กดแล้วไม่เกิดอะไร** (กฎเดียวกับ STEP 11 เรื่องช่องทางชำระเงินที่ยังไม่พร้อม)
 */
export function WishlistHeart({
  productId,
  productName,
  initialWishlisted,
  isSignedIn,
}: WishlistHeartProps) {
  const router = useRouter();
  const [wishlisted, setWishlisted] = useState(initialWishlisted);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (pending) return;

    if (!isSignedIn) {
      const back = `${window.location.pathname}${window.location.search}`;
      router.push(`/signin?callbackUrl=${encodeURIComponent(back)}`);
      return;
    }

    setPending(true);
    setError(null);

    const next = !wishlisted;
    setWishlisted(next); // optimistic

    try {
      if (next) {
        await addToWishlist(productId);
      } else {
        await removeFromWishlist(productId);
      }
    } catch (err) {
      setWishlisted(!next); // ถอนกลับ ไม่ให้หัวใจโกหกว่าบันทึกแล้ว
      setError(err instanceof ApiClientError ? err.message : "บันทึกรายการที่ถูกใจไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-pressed={isSignedIn ? wishlisted : undefined}
        aria-label={
          !isSignedIn
            ? `เข้าสู่ระบบเพื่อเก็บ ${productName} ไว้ในรายการที่ถูกใจ`
            : wishlisted
              ? `เอา ${productName} ออกจากรายการที่ถูกใจ`
              : `เก็บ ${productName} ไว้ในรายการที่ถูกใจ`
        }
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition disabled:opacity-50",
          wishlisted
            ? "border-brand bg-lilac text-brand-dark"
            : "border-line hover:border-brand-soft hover:bg-lilac-50",
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Heart className={cn("size-4", wishlisted && "fill-current")} aria-hidden />
        )}
        {wishlisted ? "อยู่ในรายการที่ถูกใจ" : "เก็บไว้ดูทีหลัง"}
      </button>

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
