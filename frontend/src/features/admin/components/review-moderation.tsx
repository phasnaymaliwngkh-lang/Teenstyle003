"use client";

import { Check, EyeOff, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { moderateReview } from "@/services/review.service";
import type { ReviewStatus } from "@/types/catalog";

type Decision = Exclude<ReviewStatus, "PENDING">;

const ACTIONS: ReadonlyArray<{
  value: Decision;
  label: string;
  icon: typeof Check;
  className: string;
  /** ต้องกรอกเหตุผลไหม — การเอาความเห็นลูกค้าลงต้องอธิบายได้เสมอ */
  needsNote: boolean;
}> = [
  {
    value: "APPROVED",
    label: "อนุมัติ",
    icon: Check,
    className: "border-success bg-success text-white",
    needsNote: false,
  },
  {
    value: "HIDDEN",
    label: "ซ่อน",
    icon: EyeOff,
    className: "border-warning bg-warning text-white",
    needsNote: true,
  },
  {
    value: "REJECTED",
    label: "ไม่อนุมัติ",
    icon: X,
    className: "border-danger bg-danger text-white",
    needsNote: true,
  },
];

/**
 * ปุ่มตัดสินรีวิวของหลังบ้าน (STEP 23)
 *
 * ⚠️ **ซ่อนหรือไม่อนุมัติต้องกรอกเหตุผล** — ข้อความนี้ถูกบันทึกลง `AdminLog`
 *    และแสดงให้เจ้าของรีวิวเห็นที่หน้า "รีวิวของฉัน"
 *    การเอาความเห็นลูกค้าลงโดยไม่มีเหตุผลที่ตรวจย้อนหลังได้ คือสิ่งที่ห้ามเกิด
 *
 * ⚠️ ปุ่มที่แสดงเป็นเพียงการซ่อน/แสดงตัวเลือก — สิทธิ์จริงตรวจที่ backend
 *    (`review:moderate` จากฐานข้อมูล) ทุกคำขอ
 */
export function ReviewModeration({
  reviewId,
  currentStatus,
}: {
  reviewId: string;
  currentStatus: ReviewStatus;
}) {
  const router = useRouter();
  const noteId = useId();

  const [choice, setChoice] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (decision: Decision, adminNote: string | null) => {
    setPending(true);
    setError(null);

    try {
      await moderateReview(reviewId, { status: decision, adminNote });
      setChoice(null);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setPending(false);
    }
  };

  const handleClick = (action: (typeof ACTIONS)[number]) => {
    if (pending) return;

    if (action.needsNote) {
      setChoice(action.value);
      return;
    }

    void submit(action.value, null);
  };

  const active = ACTIONS.find((action) => action.value === choice);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const isCurrent = currentStatus === action.value;

          return (
            <button
              key={action.value}
              type="button"
              onClick={() => handleClick(action)}
              disabled={pending || isCurrent}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
                choice === action.value
                  ? action.className
                  : "border-line text-muted hover:border-brand-soft hover:bg-lilac-50",
              )}
            >
              {pending && choice === action.value ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Icon className="size-4" aria-hidden />
              )}
              {isCurrent ? `${action.label}แล้ว` : action.label}
            </button>
          );
        })}
      </div>

      {active && (
        <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-3">
          <label htmlFor={`${noteId}-note`} className="text-xs font-bold">
            เหตุผลที่{active.label} (ลูกค้าจะเห็นข้อความนี้)
          </label>
          <input
            id={`${noteId}-note`}
            type="text"
            value={note}
            maxLength={500}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น ข้อความไม่เกี่ยวกับสินค้า / มีคำหยาบ"
            className="mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || note.trim().length === 0}
              onClick={() => void submit(active.value, note.trim())}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-bold transition disabled:opacity-50",
                active.className,
              )}
            >
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              ยืนยัน{active.label}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setChoice(null);
                setNote("");
              }}
              className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-xs font-semibold transition hover:border-brand-soft disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
