"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "../lib/api-error-text";

import { deleteProduct } from "@/services/admin.service";
import type { AdminProduct } from "@/types/admin";

/**
 * ลบสินค้า (STEP 14)
 *
 * ⚠️ backend ลบแบบ soft delete — ข้อมูลยังอยู่เพื่อให้ประวัติคำสั่งซื้ออ้างอิงได้
 *    UI ต้องบอกความจริงข้อนี้ ไม่ใช่บอกว่า "ลบถาวร"
 * ⚠️ สินค้าที่มีของถูกจองในออเดอร์ที่ยังไม่จบ backend จะปฏิเสธ (409)
 */
export function DeleteProductButton({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = busy || isPending;

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      await deleteProduct(product.id);

      startTransition(() => {
        router.push("/admin/products");
        router.refresh();
      });
    } catch (caught) {
      setError(describeApiError(caught, "ลบสินค้าไม่สำเร็จ"));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-danger/25 bg-danger/5 p-5">
      <h2 className="text-lg">ลบสินค้า</h2>
      <p className="mt-1 text-sm text-muted">
        สินค้าจะหายจากหน้าร้านทันที แต่ข้อมูลยังถูกเก็บไว้เบื้องหลัง
        {product.orderItemCount > 0
          ? ` เพราะมีประวัติการสั่งซื้อ ${product.orderItemCount} รายการที่ต้องอ้างอิงได้`
          : " เพื่อให้ตรวจย้อนหลังได้"}
      </p>

      {product.reservedStock > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-[12px] border border-warning/30 bg-warning/10 p-3 text-sm font-semibold text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          มีของถูกจองอยู่ {product.reservedStock} ชิ้นในคำสั่งซื้อที่ยังไม่จบ — ต้องจัดการคำสั่งซื้อ
          เหล่านั้นให้เรียบร้อยก่อน ระบบจะยังไม่ยอมให้ลบ
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-white p-3 text-sm font-semibold break-words text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {confirming ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger bg-danger px-5 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {disabled && <Loader2 className="size-4 animate-spin" aria-hidden />}
            ยืนยันลบ “{product.name}”
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={disabled}
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition disabled:opacity-60"
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger bg-white px-5 text-sm font-bold text-danger transition hover:bg-danger hover:text-white"
        >
          <Trash2 className="size-4" aria-hidden />
          ลบสินค้านี้
        </button>
      )}
    </section>
  );
}
