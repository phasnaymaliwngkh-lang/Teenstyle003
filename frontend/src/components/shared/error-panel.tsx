"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

/**
 * แผงแสดงเมื่อหน้าใดหน้าหนึ่งพังทั้งหน้า (STEP 30)
 *
 * ต่างจาก [`SectionError`](./section.tsx) ที่ใช้เมื่อ **section เดียว** โหลดไม่สำเร็จ
 * แต่ส่วนอื่นของหน้ายังใช้ได้ — ตัวนี้ใช้กับ `error.tsx` ซึ่งหมายถึงทั้งหน้าใช้ไม่ได้แล้ว
 *
 * ⚠️ **ห้ามคาดหวังว่าจะได้ข้อความสาเหตุจริงตอน production**
 *    Next แทนข้อความของ error ที่เกิดฝั่ง server ด้วยข้อความกลาง แล้วให้ `digest`
 *    (แฮชของ error) มาแทน เพื่อไม่ให้รายละเอียดภายในหลุดออกไปกับหน้าเว็บ
 *    → จึงต้องแสดง `digest` ไว้ให้ผู้ใช้แจ้งทีมงานได้ ไม่ใช่ซ่อนทิ้ง
 *    เพราะมันเป็นสิ่งเดียวที่โยงหน้าจอของผู้ใช้กับบรรทัดใน log ได้
 */
export function ErrorPanel({
  title = "หน้านี้มีปัญหาชั่วคราว",
  description = "เกิดข้อผิดพลาดที่เราไม่ได้คาดไว้ ลองอีกครั้งได้เลย ถ้ายังไม่หายแจ้งทีมงานได้",
  digest,
  onRetry,
  links = [{ href: "/", label: "กลับหน้าแรก" }],
}: {
  title?: string;
  description?: string;
  digest?: string | undefined;
  /** ฟังก์ชัน reset() ที่ Next ส่งมาให้ error boundary — ลองเรนเดอร์ส่วนที่พังใหม่ */
  onRetry?: (() => void) | undefined;
  links?: { href: string; label: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);
  const busy = isPending && clicked;

  function handleRetry() {
    if (!onRetry) return;
    setClicked(true);
    startTransition(() => {
      onRetry();
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div
        role="alert"
        className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-white p-8 text-center shadow-[var(--shadow-lift)]"
      >
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-danger/10">
          <AlertTriangle className="size-8 text-danger" aria-hidden />
        </div>

        <h1 className="mt-6 text-2xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">{description}</p>

        {digest && (
          <p className="mt-4 rounded-2xl bg-lilac-50 px-4 py-3 text-xs text-ink-soft">
            รหัสอ้างอิงสำหรับแจ้งทีมงาน
            <br />
            <code className="font-mono text-[13px] break-all text-brand-dark">{digest}</code>
          </p>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={busy}
              className="btn-brand inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden />
              {busy ? "กำลังลองใหม่…" : "ลองอีกครั้ง"}
            </button>
          )}

          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
