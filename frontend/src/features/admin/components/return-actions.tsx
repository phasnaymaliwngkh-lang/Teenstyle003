"use client";

import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { decideReturn, receiveReturn, refundReturn } from "@/services/returns.service";
import type { AdminReturnRequest } from "@/types/returns";

import { RefundForm } from "./refund-form";

/**
 * การจัดการคำขอคืนสินค้า (STEP 43) — แสดงเฉพาะขั้นที่ทำได้จาก **สถานะที่ server บอก**
 *
 * ⚠️ ปุ่มที่ซ่อนเป็นความสะดวก — ด่านจริง (สถานะ · สิทธิ์ · ยอดเงิน) อยู่ที่ backend
 * ⚠️ ตรวจรับของต้องเลือกผลของ **ทุกชิ้น** เอง ไม่มีค่าเริ่มต้น —
 *    ถ้าตั้งค่าเริ่มต้นเป็น "รับเข้าคลัง" ของชำรุดจะกลับไปวางขายเพราะพนักงานลืมกด
 * ⚠️ ไม่รับคืนต้องเขียนเหตุผล (ลูกค้าเห็นข้อความนี้)
 */
export function ReturnActions({
  request,
  canUpdate,
  canRefund,
}: {
  request: AdminReturnRequest;
  /** มีสิทธิ์ `order:update` */
  canUpdate: boolean;
  /** มีสิทธิ์ `order:refund` */
  canRefund: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [note, setNote] = useState("");
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<unknown>, fallback: string) {
    setPending(true);
    setError(null);

    try {
      await task();
      setNote("");
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, fallback));
    } finally {
      setPending(false);
    }
  }

  const canDecide = canUpdate && request.allowedDecisions.length > 0;
  const allChosen = request.items.every((item) => restock[item.id] !== undefined);

  if (!canDecide && !(canUpdate && request.canReceive) && !request.canRefund) {
    return (
      <p className="text-sm text-muted">
        {request.status === "REFUNDED" ||
        request.status === "REJECTED" ||
        request.status === "CANCELLED"
          ? "คำขอนี้จบแล้ว — ไม่มีขั้นที่ต้องทำต่อ"
          : "คุณไม่มีสิทธิ์จัดการขั้นนี้"}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {canDecide && (
        <div className="space-y-3">
          <label htmlFor={`${fieldId}-note`} className="block text-xs font-bold">
            ข้อความถึงลูกค้า{" "}
            <span className="font-normal text-muted">
              (ไม่รับคืนต้องกรอก · อนุมัติแล้วแนะนำวิธีส่งของกลับได้)
            </span>
          </label>
          <textarea
            id={`${fieldId}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
            disabled={pending}
            className="w-full rounded-[var(--radius-card)] border border-line bg-white p-3 text-sm outline-none focus:border-brand-soft"
          />
          <div className="flex flex-wrap gap-2">
            {request.allowedDecisions.includes("APPROVED") && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void run(
                    () =>
                      decideReturn(request.id, {
                        status: "APPROVED",
                        ...(note.trim() !== "" ? { note: note.trim() } : {}),
                      }),
                    "อนุมัติไม่สำเร็จ",
                  )
                }
                className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-success bg-success px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <Check className="size-4" aria-hidden />
                อนุมัติ — ให้ลูกค้าส่งของกลับ
              </button>
            )}
            {request.allowedDecisions.includes("REJECTED") && (
              <button
                type="button"
                disabled={pending || note.trim().length < 3}
                onClick={() =>
                  void run(
                    () => decideReturn(request.id, { status: "REJECTED", note: note.trim() }),
                    "บันทึกไม่สำเร็จ",
                  )
                }
                className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger/40 px-4 text-sm font-bold text-danger disabled:opacity-50"
              >
                <X className="size-4" aria-hidden />
                ไม่รับคืน
              </button>
            )}
          </div>
        </div>
      )}

      {canUpdate && request.canReceive && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-extrabold">ตรวจรับสินค้าที่ส่งคืน — ระบุทุกชิ้น</legend>
          {request.items.map((item) => (
            <div key={item.id} className="rounded-[12px] border border-line p-3">
              <p className="text-sm font-semibold break-words">
                {item.productName} × {item.quantity}
                <span className="font-normal text-muted"> · {item.variantSku}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    { value: true, label: "ขายต่อได้ — รับเข้าคลัง" },
                    { value: false, label: "ชำรุด — ไม่รับเข้าคลัง" },
                  ] as const
                ).map((option) => (
                  <label
                    key={String(option.value)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border px-3 text-xs font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
                      restock[item.id] === option.value
                        ? "border-brand bg-brand text-white"
                        : "border-line text-muted hover:border-brand-soft",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${fieldId}-restock-${item.id}`}
                      checked={restock[item.id] === option.value}
                      onChange={() =>
                        setRestock((current) => ({ ...current, [item.id]: option.value }))
                      }
                      disabled={pending}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={pending || !allChosen}
            onClick={() =>
              void run(
                () =>
                  receiveReturn(request.id, {
                    items: request.items.map((item) => ({
                      returnItemId: item.id,
                      restock: restock[item.id] === true,
                    })),
                  }),
                "บันทึกการตรวจรับไม่สำเร็จ",
              )
            }
            className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            บันทึกว่าได้รับของแล้ว
          </button>
          {!allChosen && <p className="text-xs text-muted">เลือกผลตรวจให้ครบทุกชิ้นก่อน</p>}
        </fieldset>
      )}

      {request.canRefund &&
        (canRefund ? (
          <RefundForm
            amount={request.estimatedRefund ?? 0}
            methods={request.refundMethods}
            submit={(input) => refundReturn(request.id, input)}
          />
        ) : (
          <p className="text-sm text-muted">
            ได้รับของแล้ว — รอผู้ดูแลที่มีสิทธิ์คืนเงิน (order:refund) บันทึกการคืนเงิน
          </p>
        ))}

      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
