import { Check, Circle, Clock } from "lucide-react";

import { formatDateTime } from "../lib/labels";

import { cn } from "@/lib/utils";
import type { OrderTimelineStep } from "@/types/catalog";

/**
 * ไทม์ไลน์สถานะคำสั่งซื้อ (STEP 12)
 *
 * ทุกเวลาที่แสดงมาจาก timestamp ที่บันทึกไว้จริงในฐานข้อมูล
 * ขั้นที่ยังไม่เกิดจะไม่มีเวลา — **ไม่มีการเดาว่าจะถึงเมื่อไร**
 */
export function OrderTimeline({ steps }: { steps: OrderTimelineStep[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border-2",
                  step.done
                    ? step.current
                      ? "border-brand bg-brand text-white"
                      : "border-success bg-success/10 text-success"
                    : "border-line bg-white text-muted-light",
                )}
              >
                {step.done ? (
                  step.current ? (
                    <Clock className="size-4" />
                  ) : (
                    <Check className="size-4" />
                  )
                ) : (
                  <Circle className="size-3" />
                )}
              </span>

              {!isLast && (
                <span
                  aria-hidden
                  className={cn("min-h-8 w-0.5 flex-1", step.done ? "bg-success/40" : "bg-line")}
                />
              )}
            </div>

            <div className={cn("pb-6", isLast && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-bold",
                  step.done ? "text-ink" : "text-muted-light",
                  step.current && "text-brand-dark",
                )}
              >
                {step.label}
                {step.current && (
                  <span className="ml-2 rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 text-[11px] text-brand-dark">
                    ขั้นปัจจุบัน
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {step.at !== null ? formatDateTime(step.at) : "ยังไม่ถึงขั้นนี้"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
