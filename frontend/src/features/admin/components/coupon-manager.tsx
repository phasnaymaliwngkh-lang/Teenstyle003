"use client";

import { AlertTriangle, Check, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { createCoupon, deleteCoupon, updateCoupon } from "@/services/admin.service";
import type { AdminCoupon, CreateCouponInput } from "@/types/admin";
import { formatBaht } from "@/utils/format";

const TYPE_LABEL: Record<AdminCoupon["type"], string> = {
  PERCENTAGE: "ลดเป็นเปอร์เซ็นต์",
  FIXED_AMOUNT: "ลดเป็นจำนวนเงิน",
  FREE_SHIPPING: "ส่งฟรี",
};

const STATE_LABEL: Record<AdminCoupon["state"], { text: string; tone: string }> = {
  ACTIVE: { text: "ใช้ได้", tone: "bg-success/10 text-success border-success/30" },
  SCHEDULED: { text: "ยังไม่เริ่ม", tone: "bg-lilac text-brand-dark border-brand/30" },
  EXPIRED: { text: "หมดอายุ", tone: "bg-warning/10 text-warning border-warning/30" },
  INACTIVE: { text: "ปิดใช้งาน", tone: "border-line text-muted" },
  USED_UP: { text: "ใช้ครบแล้ว", tone: "bg-warning/10 text-warning border-warning/30" },
};

/** ค่าเริ่มต้นของฟอร์ม — ช่วงเวลาเริ่มจากวันนี้ถึงอีก 30 วัน */
function emptyForm(): CreateCouponInput {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    code: "",
    name: "",
    type: "FIXED_AMOUNT",
    value: 0,
    startsAt: now.toISOString(),
    endsAt: end.toISOString(),
  };
}

/** `datetime-local` ต้องได้ค่าแบบ `YYYY-MM-DDTHH:mm` ตามเวลาเครื่องผู้ใช้ */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";

/**
 * จัดการคูปองส่วนลด (STEP 41)
 *
 * ⚠️ ตัวเลขทุกตัวที่โชว์มาจาก server — หน้านี้ไม่คำนวณสถานะหรือส่วนลดเองเลย
 *    (สถานะ "ใช้ครบแล้ว" ขึ้นกับ `usedCount` ที่เปลี่ยนตามการสั่งซื้อของลูกค้า)
 * ⚠️ ลบคูปอง = **ปิดใช้งาน** ไม่ใช่ลบถาวร เพราะคำสั่งซื้อเก่ายังอ้างถึงมัน
 *    UI ต้องบอกตรง ๆ ว่าเป็นการปิด ไม่ใช่ลบ (กฎเดียวกับการลบสินค้าของ STEP 14 ข้อ 2)
 */
export function CouponManager({ coupons }: { coupons: AdminCoupon[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateCouponInput>(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = busyId !== null || isPending;

  async function run(id: string, action: () => Promise<unknown>, successText: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(successText);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "ทำรายการไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  }

  async function submitForm() {
    await run(
      "new",
      () =>
        createCoupon({
          ...form,
          code: form.code.trim().toUpperCase(),
          name: form.name.trim(),
          ...(form.description?.trim() ? { description: form.description.trim() } : {}),
        }),
      `สร้างคูปอง ${form.code.trim().toUpperCase()} แล้ว`,
    );

    setForm(emptyForm());
    setShowForm(false);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          คูปองถูกใช้จริงตอนลูกค้ากดสั่งซื้อเท่านั้น — การกรอกรหัสที่หน้าชำระเงินเป็นการดูผลล่วงหน้า
          · ยกเลิกคำสั่งซื้อแล้วโควตาจะถูกคืนให้อัตโนมัติ
        </p>
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          disabled={busy}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
          {showForm ? "ปิดฟอร์ม" : "สร้างคูปอง"}
        </button>
      </div>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        )}
      </div>

      {showForm && (
        <div className="rounded-[var(--radius-card)] border border-brand/25 bg-lilac-50 p-5">
          <h2 className="text-lg">คูปองใหม่</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">รหัสคูปอง *</span>
              <input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                placeholder="WELCOME100"
                className={cn(inputClass, "uppercase")}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ชื่อที่ลูกค้าเห็น *</span>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="ลด 100 บาทสำหรับลูกค้าใหม่"
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ชนิดส่วนลด *</span>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as AdminCoupon["type"] })
                }
                className={inputClass}
              >
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">
                {form.type === "PERCENTAGE" ? "ลดกี่เปอร์เซ็นต์ *" : "ลดกี่บาท *"}
              </span>
              <input
                value={form.value === 0 ? "" : String(form.value)}
                onChange={(event) => setForm({ ...form, value: Number(event.target.value) || 0 })}
                inputMode="decimal"
                disabled={form.type === "FREE_SHIPPING"}
                placeholder={form.type === "FREE_SHIPPING" ? "ไม่ใช้ค่านี้" : "100"}
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ยอดขั้นต่ำ (ไม่บังคับ)</span>
              <input
                value={form.minOrderAmount == null ? "" : String(form.minOrderAmount)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    minOrderAmount: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                inputMode="decimal"
                placeholder="ไม่จำกัด"
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ส่วนลดสูงสุด (ไม่บังคับ)</span>
              <input
                value={form.maxDiscountAmount == null ? "" : String(form.maxDiscountAmount)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    maxDiscountAmount:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                inputMode="decimal"
                placeholder="ไม่จำกัด"
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ใช้ได้ทั้งหมดกี่ครั้ง (ไม่บังคับ)</span>
              <input
                value={form.usageLimit == null ? "" : String(form.usageLimit)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    usageLimit: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                inputMode="numeric"
                placeholder="ไม่จำกัด"
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">ต่อคนกี่ครั้ง (ไม่บังคับ)</span>
              <input
                value={form.perUserLimit == null ? "" : String(form.perUserLimit)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    perUserLimit: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                inputMode="numeric"
                placeholder="ไม่จำกัด"
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">เริ่มใช้ *</span>
              <input
                type="datetime-local"
                value={toLocalInput(form.startsAt)}
                onChange={(event) =>
                  setForm({ ...form, startsAt: new Date(event.target.value).toISOString() })
                }
                className={inputClass}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">หมดอายุ *</span>
              <input
                type="datetime-local"
                value={toLocalInput(form.endsAt)}
                onChange={(event) =>
                  setForm({ ...form, endsAt: new Date(event.target.value).toISOString() })
                }
                className={inputClass}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void submitForm()}
            disabled={busy || form.code.trim() === "" || form.name.trim() === ""}
            className="btn-brand mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            สร้างคูปอง
          </button>

          <p className="mt-3 text-xs text-muted">
            เงื่อนไขทุกข้อถูกตรวจซ้ำที่ server ตอนลูกค้าใช้จริง — ที่นี่เป็นเพียงการตั้งค่า
          </p>
        </div>
      )}

      {coupons.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-6 text-sm text-muted">
          ยังไม่มีคูปองในระบบ — กด &ldquo;สร้างคูปอง&rdquo; เพื่อเพิ่มใบแรก
        </p>
      ) : (
        <ul className="space-y-3">
          {coupons.map((coupon) => {
            const state = STATE_LABEL[coupon.state];

            return (
              <li
                key={coupon.id}
                className="rounded-[var(--radius-card)] border border-line bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-extrabold text-brand-dark">
                        {coupon.code}
                      </span>
                      <span
                        className={cn(
                          "inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border px-2.5 text-xs font-bold",
                          state.tone,
                        )}
                      >
                        {state.text}
                      </span>
                    </p>
                    <p className="mt-1 text-sm font-semibold">{coupon.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {TYPE_LABEL[coupon.type]}
                      {coupon.type === "PERCENTAGE" && ` ${coupon.value}%`}
                      {coupon.type === "FIXED_AMOUNT" && ` ${formatBaht(coupon.value)}`}
                      {coupon.minOrderAmount !== null &&
                        ` · ขั้นต่ำ ${formatBaht(coupon.minOrderAmount)}`}
                      {coupon.maxDiscountAmount !== null &&
                        ` · ลดไม่เกิน ${formatBaht(coupon.maxDiscountAmount)}`}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      ใช้ไปแล้ว {coupon.usedCount}
                      {coupon.usageLimit === null
                        ? " ครั้ง (ไม่จำกัด)"
                        : ` / ${coupon.usageLimit} ครั้ง`}
                      {coupon.perUserLimit !== null &&
                        ` · ต่อคนไม่เกิน ${coupon.perUserLimit} ครั้ง`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          coupon.id,
                          () => updateCoupon(coupon.id, { isActive: !coupon.isActive }),
                          coupon.isActive ? "ปิดใช้งานคูปองแล้ว" : "เปิดใช้งานคูปองแล้ว",
                        )
                      }
                      disabled={busy}
                      aria-label={
                        coupon.isActive
                          ? `ปิดใช้งานคูปอง ${coupon.code}`
                          : `เปิดใช้งานคูปอง ${coupon.code}`
                      }
                      className="grid size-11 place-items-center rounded-full text-muted transition hover:bg-lilac hover:text-brand disabled:opacity-40"
                    >
                      <Power className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          coupon.id,
                          () => deleteCoupon(coupon.id),
                          "เอาคูปองออกจากรายการแล้ว",
                        )
                      }
                      disabled={busy}
                      aria-label={`เอาคูปอง ${coupon.code} ออกจากรายการ`}
                      className="grid size-11 place-items-center rounded-full text-muted transition hover:bg-danger/5 hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
