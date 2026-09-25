import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ไม่พบหน้านี้",
  // ไม่ให้ search engine เก็บหน้า 404 เข้าดัชนี
  robots: { index: false, follow: true },
};

/**
 * หน้า 404 ของทุก URL ที่ไม่ตรงกับ route ใดเลย (STEP 30)
 *
 * เดิมไม่มีไฟล์นี้ → ผู้ใช้ที่พิมพ์ URL ผิดเจอหน้า 404 เริ่มต้นของ Next
 * ซึ่งเป็นภาษาอังกฤษ ไม่มีแบรนด์ และ **ไม่มีทางไปต่อเลยนอกจากกดย้อนกลับ**
 *
 * ⚠️ Next เรนเดอร์ไฟล์นี้ด้วย **root layout เท่านั้น** ไม่ใช่ layout ของกลุ่ม (storefront)
 *    จึงไม่มี navbar — ต้องมีลิงก์ของตัวเองให้ครบ ไม่ใช่พึ่งเมนูด้านบน
 *    (หน้า `not-found.tsx` ที่อยู่ในโฟลเดอร์ของ route เช่น `product/[slug]` ยังมี navbar ตามปกติ)
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 shadow-[var(--shadow-lift)]">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-lilac">
            <Compass className="size-8 text-brand-dark" aria-hidden />
          </div>

          <p className="mt-6 text-sm font-bold tracking-widest text-brand-soft">404</p>
          <h1 className="mt-1 text-2xl">ไม่พบหน้านี้</h1>
          <p className="mt-3 text-sm text-muted">
            ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว ลองเริ่มจากทางเลือกด้านล่างได้เลย
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              href="/"
              className="btn-brand flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
            >
              หน้าแรก
            </Link>
            <Link
              href="/shop"
              className="flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              สินค้าทั้งหมด
            </Link>
            <Link
              href="/looks"
              className="flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              ไอเดียการแต่งตัว
            </Link>
            <Link
              href="/faq"
              className="flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              คำถามที่พบบ่อย
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
