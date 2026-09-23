"use client";

import { Ban, CheckCircle2, Loader2, PauseCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { updateCustomerRole, updateCustomerStatus } from "@/services/customer.service";
import { ROLE_NAMES, type CustomerRoleName, type UserStatus } from "@/types/customer";

/**
 * เปลี่ยนสถานะและบทบาทของบัญชี (STEP 25)
 *
 * ⚠️ **ทุกการเปลี่ยนต้องกรอกเหตุผล** — ข้อความนี้ถูกบันทึกลง `AdminLog`
 *    การตัดคนออกจากร้านหรือมอบสิทธิ์เข้าหลังบ้านต้องตรวจย้อนหลังได้ว่าใครทำเพราะอะไร
 *
 * ⚠️ **ระงับบัญชี = เพิกถอน session ทั้งหมดของคนนั้นทันที** — ต้องบอกบนหน้าจอให้ชัด
 *    ไม่งั้นแอดมินจะไม่รู้ว่ากดแล้วลูกค้าถูกเด้งออกจากระบบกลางทาง
 *
 * ⚠️ ปุ่มที่ซ่อน/แสดงเป็นเพียงความสะดวก — กฎจริงทั้งหมด (ห้ามแก้บัญชีตัวเอง ·
 *    แตะได้แค่บทบาทที่ต่ำกว่าตัวเอง · ตั้งบทบาทได้ไม่เกินระดับตัวเอง) ตรวจที่ backend
 */
const STATUS_ACTIONS: ReadonlyArray<{
  value: UserStatus;
  label: string;
  icon: typeof Ban;
  className: string;
  hint: string;
}> = [
  {
    value: "ACTIVE",
    label: "ให้ใช้งานได้",
    icon: CheckCircle2,
    className: "border-success bg-success text-white",
    hint: "ลูกค้ากลับมาเข้าสู่ระบบและสั่งซื้อได้ปกติ",
  },
  {
    value: "SUSPENDED",
    label: "ระงับชั่วคราว",
    icon: PauseCircle,
    className: "border-warning bg-warning text-white",
    hint: "เข้าสู่ระบบไม่ได้จนกว่าจะปลดระงับ · session ที่ค้างอยู่ถูกเพิกถอนทันที",
  },
  {
    value: "BANNED",
    label: "แบนถาวร",
    icon: Ban,
    className: "border-danger bg-danger text-white",
    hint: "ใช้กับกรณีที่ไม่ให้กลับมาอีก · ข้อมูลและคำสั่งซื้อเดิมยังอยู่ (ไม่ใช่การลบบัญชี)",
  },
];

const ROLE_LABEL: Record<CustomerRoleName, string> = {
  CUSTOMER: "ลูกค้า — ซื้อของ รีวิว ดูคำสั่งซื้อของตัวเอง",
  EMPLOYEE: "พนักงาน — จัดการสต็อก คำสั่งซื้อ และตอบลูกค้า",
  ADMIN: "ผู้ดูแลร้าน — จัดการสินค้า โปรโมชัน รายงาน",
  SUPER_ADMIN: "ผู้ดูแลระบบ — มีสิทธิ์ทั้งหมดรวมถึงการจัดการสิทธิ์",
};

const reasonInputClass =
  "mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20";

export function CustomerAccountActions({
  userId,
  currentStatus,
  currentRole,
  canUpdateStatus,
  canManageRole,
  isSelf,
}: {
  userId: string;
  currentStatus: string;
  currentRole: string;
  canUpdateStatus: boolean;
  canManageRole: boolean;
  /** บัญชีของตัวเอง — backend ปฏิเสธอยู่แล้ว UI แค่บอกเหตุผลล่วงหน้า */
  isSelf: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();

  const [statusChoice, setStatusChoice] = useState<UserStatus | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [roleChoice, setRoleChoice] = useState<CustomerRoleName>(currentRole as CustomerRoleName);
  const [roleReason, setRoleReason] = useState("");

  const [pending, setPending] = useState<"status" | "role" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submitStatus = async (status: UserStatus) => {
    setPending("status");
    setError(null);
    setNotice(null);

    try {
      await updateCustomerStatus(userId, { status, reason: statusReason.trim() });
      setStatusChoice(null);
      setStatusReason("");
      setNotice("บันทึกสถานะบัญชีแล้ว");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกสถานะไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  };

  const submitRole = async () => {
    setPending("role");
    setError(null);
    setNotice(null);

    try {
      await updateCustomerRole(userId, { role: roleChoice, reason: roleReason.trim() });
      setRoleReason("");
      setNotice("บันทึกบทบาทของบัญชีแล้ว");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกบทบาทไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  };

  if (isSelf) {
    return (
      <p className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4 text-sm text-ink-soft">
        นี่คือบัญชีของคุณเอง — เปลี่ยนสถานะหรือบทบาทตัวเองจากหน้านี้ไม่ได้
        เพื่อกันการล็อกตัวเองออกจากระบบ ถ้าจำเป็นให้ผู้ดูแลอีกคนทำให้
      </p>
    );
  }

  const active = STATUS_ACTIONS.find((action) => action.value === statusChoice);

  return (
    <div className="space-y-6">
      <div aria-live="polite">
        {notice !== null && error === null && (
          <p className="text-sm font-semibold text-success">{notice}</p>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {/* ─── สถานะบัญชี ─── */}
      <section>
        <h3 className="text-sm font-extrabold">สถานะบัญชี</h3>
        {canUpdateStatus ? (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {STATUS_ACTIONS.map((action) => {
                const Icon = action.icon;
                const isCurrent = currentStatus === action.value;

                return (
                  <button
                    key={action.value}
                    type="button"
                    disabled={pending !== null || isCurrent}
                    onClick={() =>
                      setStatusChoice(statusChoice === action.value ? null : action.value)
                    }
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
                      statusChoice === action.value
                        ? action.className
                        : "border-line text-muted hover:border-brand-soft hover:bg-lilac-50",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {isCurrent ? `${action.label} (ปัจจุบัน)` : action.label}
                  </button>
                );
              })}
            </div>

            {active && (
              <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-3">
                <p className="text-xs text-ink-soft">{active.hint}</p>
                <label
                  htmlFor={`${fieldId}-status-reason`}
                  className="mt-3 block text-xs font-bold"
                >
                  เหตุผล (บันทึกใน Audit log)
                </label>
                <input
                  id={`${fieldId}-status-reason`}
                  type="text"
                  value={statusReason}
                  maxLength={500}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="เช่น สั่งของแล้วปฏิเสธรับหลายครั้ง"
                  className={reasonInputClass}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending !== null || statusReason.trim().length < 3}
                    onClick={() => void submitStatus(active.value)}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-bold transition disabled:opacity-50",
                      active.className,
                    )}
                  >
                    {pending === "status" && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    ยืนยัน{active.label}
                  </button>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => {
                      setStatusChoice(null);
                      setStatusReason("");
                    }}
                    className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-xs font-semibold transition hover:border-brand-soft disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            คุณมีสิทธิ์ดูข้อมูลลูกค้าเท่านั้น — การระงับบัญชีต้องมีสิทธิ์ `customer:update`
          </p>
        )}
      </section>

      {/* ─── บทบาทและสิทธิ์ ─── */}
      <section className="border-t border-line pt-5">
        <h3 className="flex items-center gap-2 text-sm font-extrabold">
          <ShieldCheck className="size-4 text-brand" aria-hidden />
          บทบาทและสิทธิ์
        </h3>

        {canManageRole ? (
          <>
            <p className="mt-2 text-xs text-muted">
              สิทธิ์ของแต่ละบทบาทอ่านจากฐานข้อมูล (ตาราง Role ↔ Permission) และ
              <span className="font-semibold"> มีผลทันทีทุกคำขอถัดไปโดยไม่ต้องล็อกอินใหม่</span>
            </p>

            <label htmlFor={`${fieldId}-role`} className="mt-3 block text-xs font-bold">
              บทบาทใหม่
            </label>
            <select
              id={`${fieldId}-role`}
              value={roleChoice}
              onChange={(event) => setRoleChoice(event.target.value as CustomerRoleName)}
              className="mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
            >
              {ROLE_NAMES.map((role) => (
                <option key={role} value={role}>
                  {role} — {ROLE_LABEL[role]}
                </option>
              ))}
            </select>

            {roleChoice !== currentRole && (
              <>
                <label htmlFor={`${fieldId}-role-reason`} className="mt-3 block text-xs font-bold">
                  เหตุผล (บันทึกใน Audit log)
                </label>
                <input
                  id={`${fieldId}-role-reason`}
                  type="text"
                  value={roleReason}
                  maxLength={500}
                  onChange={(event) => setRoleReason(event.target.value)}
                  placeholder="เช่น เริ่มงานตำแหน่งพนักงานคลังวันนี้"
                  className={reasonInputClass}
                />
                <button
                  type="button"
                  disabled={pending !== null || roleReason.trim().length < 3}
                  onClick={() => void submitRole()}
                  className="btn-brand mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-xs font-bold transition disabled:opacity-50"
                >
                  {pending === "role" && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  เปลี่ยนเป็น {roleChoice}
                </button>
              </>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            การเปลี่ยนบทบาทต้องมีสิทธิ์ `user:role:manage` (ตาม seed คือ SUPER_ADMIN เท่านั้น)
          </p>
        )}
      </section>
    </div>
  );
}
