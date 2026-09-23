"use client";

import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  createMyAddress,
  deleteMyAddress,
  setMyDefaultAddress,
  updateMyAddress,
} from "@/services/customer.service";
import type { Address, AddressInput } from "@/types/customer";

import { AddressForm } from "./address-form";

/**
 * สมุดที่อยู่ (STEP 25)
 *
 * ⚠️ ไม่เก็บรายการที่อยู่ไว้ใน state — หลังบันทึกทุกครั้งเรียก `router.refresh()`
 *    ให้ Server Component ดึงของจริงมาใหม่ (`cache: "no-store"`)
 *    ถ้าเก็บสำเนาไว้เองจะมีแหล่งความจริงสองที่ แล้วป้าย "ค่าเริ่มต้น" จะเพี้ยน
 *    เมื่อ backend ปลดค่าเริ่มต้นของอันเดิมให้เองในทรานแซกชันเดียวกัน
 *
 * ⚠️ **การลบเป็น soft delete** — คำสั่งซื้อที่สั่งไปแล้วยังอ้างถึงที่อยู่นั้นอยู่
 *    ข้อความบนปุ่มยืนยันจึงต้องไม่พูดว่า "ลบถาวร"
 */
type Mode = { kind: "idle" } | { kind: "create" } | { kind: "edit"; addressId: string };

export function AddressBook({ addresses }: { addresses: Address[] }) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (id: string, task: () => Promise<unknown>, successMessage: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await task();
      setNotice(successMessage);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (values: AddressInput) => {
    await createMyAddress(values);
    setMode({ kind: "idle" });
    setNotice("เพิ่มที่อยู่แล้ว");
    setError(null);
    router.refresh();
  };

  const handleUpdate = async (addressId: string, values: AddressInput) => {
    await updateMyAddress(addressId, values);
    setMode({ kind: "idle" });
    setNotice("บันทึกที่อยู่แล้ว");
    setError(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="sr-only">
        {notice ?? ""}
      </div>

      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {notice !== null && error === null && (
        <p className="text-sm font-semibold text-success">{notice}</p>
      )}

      {addresses.length === 0 && mode.kind !== "create" && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
          <MapPin className="mx-auto size-10 text-brand-soft" aria-hidden />
          <p className="mt-3 font-extrabold">ยังไม่มีที่อยู่ในสมุดที่อยู่</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            เพิ่มไว้ล่วงหน้าจะสั่งซื้อได้เร็วขึ้น — หรือกรอกที่อยู่ใหม่ตอนชำระเงินก็ได้
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {addresses.map((address) => {
          const isEditing = mode.kind === "edit" && mode.addressId === address.id;
          const isBusy = busyId === address.id;

          return (
            <li
              key={address.id}
              className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)] sm:p-5"
            >
              {isEditing ? (
                <AddressForm
                  address={address}
                  hideDefaultToggle={address.isDefault}
                  submitLabel="บันทึกที่อยู่"
                  onSubmit={(values) => handleUpdate(address.id, values)}
                  onCancel={() => setMode({ kind: "idle" })}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold">{address.label ?? "ที่อยู่จัดส่ง"}</span>
                        {address.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-[11px] font-bold text-brand-dark">
                            <Star className="size-3" aria-hidden />
                            ค่าเริ่มต้น
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold">
                        {address.recipientName} · {address.phone}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {[
                          address.line1,
                          address.line2,
                          address.subDistrict,
                          address.district,
                          address.province,
                          address.postalCode,
                        ]
                          .filter((part) => part !== null && part !== "")
                          .join(" ")}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {!address.isDefault && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void run(
                              address.id,
                              () => setMyDefaultAddress(address.id),
                              "ตั้งเป็นที่อยู่เริ่มต้นแล้ว",
                            )
                          }
                          className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line px-3.5 text-xs font-bold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Star className="size-4" aria-hidden />
                          )}
                          ตั้งเป็นค่าเริ่มต้น
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setMode({ kind: "edit", addressId: address.id });
                          setConfirmDeleteId(null);
                        }}
                        aria-label={`แก้ไขที่อยู่ ${address.label ?? address.recipientName}`}
                        className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line px-3.5 text-xs font-bold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
                      >
                        <Pencil className="size-4" aria-hidden />
                        แก้ไข
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setConfirmDeleteId(confirmDeleteId === address.id ? null : address.id)
                        }
                        aria-label={`ลบที่อยู่ ${address.label ?? address.recipientName}`}
                        className={cn(
                          "flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3.5 text-xs font-bold transition disabled:opacity-50",
                          confirmDeleteId === address.id
                            ? "border-danger text-danger"
                            : "border-line text-muted hover:border-danger hover:text-danger",
                        )}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        ลบ
                      </button>
                    </div>
                  </div>

                  {confirmDeleteId === address.id && (
                    <div className="mt-3 rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-3">
                      <p className="text-sm font-semibold">ลบที่อยู่นี้ออกจากสมุดที่อยู่?</p>
                      <p className="mt-1 text-xs text-muted">
                        คำสั่งซื้อที่สั่งไปแล้วไม่เปลี่ยน —
                        ระบบเก็บที่อยู่ปลายทางของแต่ละใบไว้ต่างหาก
                        {address.isDefault && " · ระบบจะเลื่อนที่อยู่อื่นขึ้นมาเป็นค่าเริ่มต้นแทน"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void run(
                              address.id,
                              async () => {
                                await deleteMyAddress(address.id);
                                setConfirmDeleteId(null);
                              },
                              "ลบที่อยู่แล้ว",
                            )
                          }
                          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger bg-danger px-4 text-xs font-bold text-white transition disabled:opacity-50"
                        >
                          {isBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                          ยืนยันลบ
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-xs font-semibold transition hover:border-brand-soft disabled:opacity-50"
                        >
                          ไม่ลบ
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {mode.kind === "create" ? (
        <AddressForm
          hideDefaultToggle={addresses.length === 0}
          submitLabel="เพิ่มที่อยู่"
          onSubmit={handleCreate}
          onCancel={() => setMode({ kind: "idle" })}
        />
      ) : (
        mode.kind === "idle" && (
          <button
            type="button"
            onClick={() => {
              setMode({ kind: "create" });
              setConfirmDeleteId(null);
              setNotice(null);
            }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-brand-soft bg-lilac-50 px-5 text-sm font-bold text-brand-dark transition hover:bg-lilac"
          >
            <Plus className="size-4" aria-hidden />
            เพิ่มที่อยู่ใหม่
          </button>
        )
      )}
    </div>
  );
}
