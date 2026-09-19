"use client";

import { PenLine, ShoppingBag, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { Review, ReviewEligibility } from "@/types/catalog";

import { ReviewForm } from "./review-form";

/**
 * กล่อง "เขียนรีวิว" บนหน้าสินค้า (STEP 23)
 *
 * ⚠️ **บอกความจริงทุกกรณีว่าทำไมเขียนไม่ได้** แทนที่จะซ่อนปุ่มเงียบ ๆ
 *    "ยังไม่เคยซื้อ" กับ "ซื้อแล้วแต่ของยังไม่ถึง" เป็นคนละเรื่อง ต้องบอกคนละอย่าง
 *    (แพตเทิร์นเดียวกับ STEP 11 ที่ช่องทางชำระเงินซึ่งยังไม่พร้อมต้องบอกเหตุผลจาก server)
 *
 * เหตุผลมาจาก backend (`/api/reviews/eligibility`) ไม่ได้เดาที่ฝั่ง client
 */
export function ReviewComposer({
  productId,
  isSignedIn,
  signInHref,
  eligibility,
  myReview,
}: {
  productId: string;
  isSignedIn: boolean;
  signInHref: string;
  /** null = ยังไม่ล็อกอิน หรือถามสิทธิ์ไม่สำเร็จ */
  eligibility: ReviewEligibility | null;
  myReview: Review | null;
}) {
  const [open, setOpen] = useState(false);

  if (!isSignedIn) {
    return (
      <Box>
        <p className="text-sm font-bold">เคยซื้อสินค้าชิ้นนี้ไหม</p>
        <p className="mt-1 text-sm text-muted">
          เข้าสู่ระบบเพื่อเขียนรีวิว — ร้านเปิดให้รีวิวเฉพาะคนที่สั่งซื้อและได้รับสินค้าแล้วเท่านั้น
        </p>
        <Link
          href={signInHref}
          className="btn-brand mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          เข้าสู่ระบบ
        </Link>
      </Box>
    );
  }

  if (myReview !== null) {
    return open ? (
      <ReviewForm
        productId={productId}
        existing={myReview}
        onDone={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    ) : (
      <Box>
        <p className="text-sm font-bold">คุณรีวิวสินค้าชิ้นนี้ไปแล้ว</p>
        <p className="mt-1 text-sm text-muted">
          แก้ไขได้ตลอด — แต่รีวิวที่แก้แล้วจะกลับไปรอร้านตรวจสอบอีกครั้งก่อนขึ้นหน้าสินค้า
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-brand-soft px-5 text-sm font-semibold text-brand-dark transition hover:bg-lilac-50"
          >
            <PenLine className="size-4" aria-hidden />
            แก้ไขรีวิวของฉัน
          </button>
          <Link
            href="/account/reviews"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ดูรีวิวทั้งหมดของฉัน
          </Link>
        </div>
      </Box>
    );
  }

  if (eligibility?.reason === "NOT_DELIVERED") {
    return (
      <Box>
        <p className="flex items-center gap-2 text-sm font-bold">
          <Truck className="size-4 text-brand" aria-hidden />
          รีวิวได้เมื่อได้รับสินค้าแล้ว
        </p>
        <p className="mt-1 text-sm text-muted">
          คำสั่งซื้อของคุณยังอยู่ระหว่างจัดส่ง — ติดตามสถานะได้ที่ประวัติคำสั่งซื้อ
        </p>
        <Link
          href="/account/orders"
          className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ดูคำสั่งซื้อของฉัน
        </Link>
      </Box>
    );
  }

  if (eligibility?.canReview !== true) {
    return (
      <Box>
        <p className="flex items-center gap-2 text-sm font-bold">
          <ShoppingBag className="size-4 text-brand" aria-hidden />
          รีวิวได้เฉพาะคนที่ซื้อจริง
        </p>
        <p className="mt-1 text-sm text-muted">
          ทุกรีวิวบนหน้านี้มาจากลูกค้าที่สั่งซื้อและได้รับสินค้าแล้ว
          จึงเป็นความเห็นจากการใช้งานจริงทั้งหมด
        </p>
      </Box>
    );
  }

  return open ? (
    <ReviewForm
      productId={productId}
      onDone={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <Box>
      <p className="text-sm font-bold">คุณซื้อสินค้าชิ้นนี้แล้ว</p>
      <p className="mt-1 text-sm text-muted">
        เล่าให้คนอื่นฟังหน่อย — จากคำสั่งซื้อ {eligibility.orderNumber}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-brand mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
      >
        <PenLine className="size-4" aria-hidden />
        เขียนรีวิว
      </button>
    </Box>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-5">
      {children}
    </div>
  );
}
