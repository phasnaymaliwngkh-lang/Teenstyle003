import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { CartSummary } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/**
 * สรุปยอดในตะกร้า (STEP 9) — Server Component
 *
 * ทุกตัวเลขมาจาก backend ตรง ๆ **ไม่บวกซ้ำที่ client**
 * ค่าจัดส่งเป็น `null` จนกว่าจะรู้ที่อยู่ผู้รับ (STEP 10/44) จึงแสดงว่า "คำนวณตอนชำระเงิน"
 * — ห้ามใส่เลขสมมติเพื่อให้หน้าดูครบ
 */
export function CartSummaryCard({ summary, isGuest }: { summary: CartSummary; isGuest: boolean }) {
  return (
    <aside
      aria-label="สรุปยอดคำสั่งซื้อ"
      className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] lg:sticky lg:top-24"
    >
      <h2 className="text-lg">สรุปยอด</h2>

      <dl className="mt-4 space-y-2.5 text-sm">
        <Row
          label={`ยอดสินค้าที่เลือก (${summary.selectedCount} จาก ${summary.itemCount} รายการ)`}
          value={formatBaht(summary.subtotal)}
        />

        <Row
          label="ส่วนลด"
          value={summary.discountTotal > 0 ? `-${formatBaht(summary.discountTotal)}` : "—"}
          hint={summary.discountTotal === 0 ? "ใส่คูปองได้ใน STEP 41" : undefined}
        />

        <Row
          label="ค่าจัดส่ง"
          value={
            summary.shippingFee === null ? "คำนวณตอนชำระเงิน" : formatBaht(summary.shippingFee)
          }
          hint={summary.shippingFee === null ? "ต้องรู้ที่อยู่ผู้รับก่อน (STEP 10)" : undefined}
        />

        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <dt className="font-extrabold">ยอดรวมที่ต้องจ่าย</dt>
          <dd className="text-xl font-extrabold text-brand-dark">{formatBaht(summary.total)}</dd>
        </div>
        {summary.shippingFee === null && (
          <p className="text-xs text-muted">ยอดนี้ยังไม่รวมค่าจัดส่ง</p>
        )}
      </dl>

      {summary.hasIssues && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[12px] border border-warning/30 bg-warning/5 p-3 text-xs font-semibold text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          มีรายการที่ต้องแก้ก่อนสั่งซื้อ — ยอดด้านบนนับเฉพาะรายการที่ซื้อได้จริง
        </p>
      )}

      {/* ปุ่มจริงของ STEP 10 — ถ้ายังไม่พร้อมสั่งซื้อ จะไม่ทำเป็นลิงก์เลย (ไม่มีปุ่มที่กดแล้วเด้งกลับ) */}
      {summary.checkoutReady ? (
        <Link
          href="/checkout"
          className="btn-brand mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-base font-bold transition"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          ดำเนินการสั่งซื้อ
        </Link>
      ) : (
        <div className="mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-line bg-lilac-50 text-base font-bold text-muted-light">
          <Lock className="size-4 shrink-0" aria-hidden />
          เลือกสินค้าที่จะสั่งก่อน
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
        ราคาและสต็อกถูกตรวจใหม่จากเซิร์ฟเวอร์ทุกครั้งที่หน้านี้โหลด และจะตรวจซ้ำอีกครั้งตอนสั่งซื้อ
      </p>

      {isGuest && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
          ตะกร้านี้ผูกกับเบราว์เซอร์นี้ไว้ 30 วัน ·{" "}
          <Link href="/signin" className="font-bold text-brand underline">
            เข้าสู่ระบบ
          </Link>{" "}
          แล้วของในตะกร้าจะถูกรวมเข้าบัญชีให้อัตโนมัติ
        </p>
      )}
    </aside>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">
        {label}
        {hint && <span className="block text-[11px] text-muted-light">{hint}</span>}
      </dt>
      <dd className="shrink-0 font-semibold">{value}</dd>
    </div>
  );
}
