"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  PenLine,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import {
  catalogRows,
  checkCatalogValues,
  emptyCatalogValues,
  moveWithinGroup,
  nounOf,
  toCreateBody,
  toUpdateBody,
  valuesOf,
  type CatalogFormValues,
  type CatalogRow,
} from "../lib/catalog-form";

import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import {
  createCatalogItem,
  deleteCatalogItem,
  reorderCatalog,
  updateCatalogItem,
} from "@/services/admin.service";
import type { CatalogKind, CatalogOverview } from "@/types/admin";

const inputClass =
  "mt-1 min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft disabled:bg-lilac-50 disabled:text-muted";

/**
 * จัดการหมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *
 * ⚠️ **ปุ่มที่ทำไม่ได้แสดงเหตุผลจาก server** (`blockers`) แทนการซ่อนเงียบ ๆ
 *    ร้านต้องรู้ว่าต้องย้ายสินค้าไหนก่อนจึงจะปิดหมวดได้ — server ตัดสินซ้ำทุกครั้งอยู่ดี
 * ⚠️ ทุกการเปลี่ยนใช้ภาพรวมชุดใหม่ที่ server ตอบกลับ ไม่แก้ state ในหน้าเอง
 *    (ปิดหมวดย่อยแล้ว "ปิดหมวดแม่" ที่เคยติดอยู่จะกดได้ทันทีโดยไม่ต้องคิดเอง)
 */
export function CatalogManager({
  kind,
  initial,
  canManage,
}: {
  kind: CatalogKind;
  initial: CatalogOverview;
  canManage: boolean;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [, startTransition] = useTransition();

  const [overview, setOverview] = useState(initial);
  const [createValues, setCreateValues] = useState<CatalogFormValues>(emptyCatalogValues);
  const [editing, setEditing] = useState<{ id: string; values: CatalogFormValues } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const noun = nounOf(kind);
  const rows = catalogRows(overview, kind);
  const roots = kind === "categories" ? rows.filter((row) => row.depth === 0) : [];

  async function run(key: string, action: () => Promise<CatalogOverview>, message: string) {
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      setOverview(await action());
      setNotice(message);
      startTransition(() => router.refresh());
      return true;
    } catch (caught) {
      setError(describeApiError(caught, `บันทึก${noun}ไม่สำเร็จ`));
      return false;
    } finally {
      setBusy(null);
      setConfirmDeleteId(null);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = checkCatalogValues(kind, createValues);
    if (problem !== null) {
      setError(problem);
      setNotice(null);
      return;
    }

    const ok = await run(
      "create",
      () => createCatalogItem(kind, toCreateBody(kind, createValues)),
      `เพิ่ม${noun}แล้ว`,
    );
    if (ok) setCreateValues(emptyCatalogValues());
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>, row: CatalogRow) {
    event.preventDefault();
    if (editing === null) return;

    const problem = checkCatalogValues(kind, editing.values);
    if (problem !== null) {
      setError(problem);
      return;
    }

    const body = toUpdateBody(kind, editing.values, row);
    if (Object.keys(body).length === 0) {
      setEditing(null);
      setNotice("ยังไม่มีอะไรเปลี่ยน จึงไม่ได้บันทึก");
      return;
    }

    const ok = await run(row.id, () => updateCatalogItem(kind, row.id, body), `บันทึก${noun}แล้ว`);
    if (ok) setEditing(null);
  }

  function move(row: CatalogRow, direction: -1 | 1) {
    const ids = moveWithinGroup(rows, row.id, direction);
    if (ids === null || kind === "brands") return;

    void run(
      row.id,
      () => reorderCatalog(kind, ids, kind === "categories" ? row.parentId : undefined),
      "เรียงลำดับใหม่แล้ว",
    );
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <form
          onSubmit={(event) => void submitCreate(event)}
          className="rounded-[var(--radius-card)] border border-line bg-white p-5"
          aria-labelledby={`${fieldId}-create`}
        >
          <h2 id={`${fieldId}-create`} className="flex items-center gap-2 text-lg">
            <Plus className="size-5 text-brand" aria-hidden />
            เพิ่ม{noun}
          </h2>
          <CatalogFields
            kind={kind}
            idPrefix={`${fieldId}-new`}
            values={createValues}
            onChange={setCreateValues}
            roots={roots}
            disabled={busy !== null}
            keyLock={null}
            parentLock={null}
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="btn-brand mt-4 flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold disabled:opacity-50"
          >
            {busy === "create" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            เพิ่ม{noun}
          </button>
        </form>
      ) : (
        <p className="rounded-[12px] border border-line bg-lilac-50 p-3 text-sm text-muted">
          คุณดูรายการได้อย่างเดียว — การเพิ่ม แก้ ปิด หรือลบ
          ต้องมีสิทธิ์จัดการหมวดหมู่และตัวเลือกสินค้า
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/30 bg-danger/5 p-3 text-sm font-semibold text-danger"
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

      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-6 text-center text-sm text-muted">
          ยังไม่มี{noun}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const groupIds = rows
              .filter((other) => other.group === row.group)
              .map((other) => other.id);
            const position = groupIds.indexOf(row.id);
            const isEditing = editing?.id === row.id;
            const rowBusy = busy === row.id;
            const toggleBlocked = row.isActive ? row.blockers.deactivate : null;

            return (
              <li
                key={row.id}
                className={cn(
                  "min-w-0 rounded-[var(--radius-card)] border border-line bg-white p-4",
                  row.depth === 1 && "ml-4 sm:ml-8",
                  !row.isActive && "bg-lilac-50",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {row.hex !== null && (
                        <span
                          aria-hidden
                          className="inline-block size-5 shrink-0 rounded-full border border-line"
                          style={{ backgroundColor: row.hex }}
                        />
                      )}
                      <span className="break-words">{row.name}</span>
                      <span className="rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 font-mono text-xs font-normal text-brand-dark">
                        {row.key}
                      </span>
                      {!row.isActive && (
                        <span className="rounded-[var(--radius-pill)] border border-line px-2 py-0.5 text-xs font-semibold text-muted">
                          ปิดใช้งาน
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted">{row.usage}</p>
                  </div>

                  {canManage && !isEditing && (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.group !== null && (
                        <>
                          <button
                            type="button"
                            onClick={() => move(row, -1)}
                            disabled={busy !== null || position <= 0}
                            aria-label={`เลื่อน${noun} ${row.name} ขึ้น`}
                            className="grid size-11 place-items-center rounded-full border border-line transition hover:border-brand-soft disabled:opacity-40"
                          >
                            <ArrowUp className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(row, 1)}
                            disabled={busy !== null || position >= groupIds.length - 1}
                            aria-label={`เลื่อน${noun} ${row.name} ลง`}
                            className="grid size-11 place-items-center rounded-full border border-line transition hover:border-brand-soft disabled:opacity-40"
                          >
                            <ArrowDown className="size-4" aria-hidden />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({ id: row.id, values: valuesOf(row) });
                          setError(null);
                        }}
                        disabled={busy !== null}
                        className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                      >
                        <PenLine className="size-4" aria-hidden />
                        แก้ไข
                        <span className="sr-only">{row.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            row.id,
                            () => updateCatalogItem(kind, row.id, { isActive: !row.isActive }),
                            row.isActive ? `ปิดใช้งาน${noun}แล้ว` : `เปิดใช้งาน${noun}แล้ว`,
                          )
                        }
                        disabled={busy !== null || toggleBlocked !== null}
                        aria-describedby={
                          toggleBlocked !== null ? `${fieldId}-block-${row.id}` : undefined
                        }
                        className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
                      >
                        {rowBusy ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Power className="size-4" aria-hidden />
                        )}
                        {row.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        <span className="sr-only">{row.name}</span>
                      </button>
                      {confirmDeleteId === row.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void run(
                                row.id,
                                () => deleteCatalogItem(kind, row.id),
                                `ลบ${noun}แล้ว`,
                              )
                            }
                            disabled={busy !== null}
                            className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-danger bg-danger px-3 text-xs font-bold text-white"
                          >
                            <Trash2 className="size-4" aria-hidden />
                            ยืนยันลบ {row.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold"
                          >
                            ไม่ลบ
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(row.id)}
                          disabled={busy !== null || row.blockers.remove !== null}
                          aria-describedby={
                            row.blockers.remove !== null ? `${fieldId}-remove-${row.id}` : undefined
                          }
                          aria-label={`ลบ${noun} ${row.name}`}
                          className="grid size-11 place-items-center rounded-full border border-line transition hover:border-danger hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {canManage &&
                  !isEditing &&
                  (toggleBlocked !== null || row.blockers.remove !== null) && (
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {toggleBlocked !== null && (
                        <li id={`${fieldId}-block-${row.id}`}>ปิดไม่ได้: {toggleBlocked}</li>
                      )}
                      {row.blockers.remove !== null && (
                        <li id={`${fieldId}-remove-${row.id}`}>ลบไม่ได้: {row.blockers.remove}</li>
                      )}
                    </ul>
                  )}

                {isEditing && editing !== null && (
                  <form onSubmit={(event) => void submitEdit(event, row)} className="mt-3">
                    <CatalogFields
                      kind={kind}
                      idPrefix={`${fieldId}-edit-${row.id}`}
                      values={editing.values}
                      onChange={(values) => setEditing({ id: row.id, values })}
                      roots={roots.filter((root) => root.id !== row.id)}
                      disabled={rowBusy}
                      keyLock={row.blockers.slug}
                      parentLock={
                        row.hasChildren
                          ? "หมวดนี้มีหมวดย่อยอยู่ จึงย้ายไปอยู่ใต้หมวดอื่นไม่ได้ (ซ้อนได้ 2 ชั้น)"
                          : null
                      }
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={rowBusy}
                        className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold disabled:opacity-50"
                      >
                        {rowBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={rowBusy}
                        className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CatalogFields({
  kind,
  idPrefix,
  values,
  onChange,
  roots,
  disabled,
  keyLock,
  parentLock,
}: {
  kind: CatalogKind;
  idPrefix: string;
  values: CatalogFormValues;
  onChange: (values: CatalogFormValues) => void;
  roots: CatalogRow[];
  disabled: boolean;
  /** เหตุผลที่แก้ slug/รหัสไม่ได้ — null = แก้ได้ */
  keyLock: string | null;
  parentLock: string | null;
}) {
  const set = (patch: Partial<CatalogFormValues>) => onChange({ ...values, ...patch });
  const keyLabel = kind === "sizes" ? "รหัสไซซ์" : "slug (ลิงก์หน้าร้าน)";

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="text-sm font-semibold">
          ชื่อ{nounOf(kind)}
        </label>
        <input
          id={`${idPrefix}-name`}
          value={values.name}
          maxLength={80}
          disabled={disabled}
          onChange={(event) => set({ name: event.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-key`} className="text-sm font-semibold">
          {keyLabel}
        </label>
        <input
          id={`${idPrefix}-key`}
          value={values.key}
          maxLength={60}
          disabled={disabled || keyLock !== null}
          aria-describedby={`${idPrefix}-key-hint`}
          onChange={(event) => set({ key: event.target.value })}
          placeholder={kind === "sizes" ? "เช่น XL หรือ EU36" : "เช่น oversize-tee"}
          className={cn(inputClass, "font-mono")}
        />
        <p id={`${idPrefix}-key-hint`} className="mt-1 text-xs text-muted">
          {keyLock ??
            (kind === "sizes"
              ? "ตัวพิมพ์ใหญ่ ตัวเลข ขีดกลาง"
              : "a-z ตัวเลข ขีดกลาง · อยู่ในลิงก์ของหน้าร้าน")}
        </p>
      </div>

      {kind === "categories" && (
        <div>
          <label htmlFor={`${idPrefix}-parent`} className="text-sm font-semibold">
            หมวดแม่
          </label>
          <select
            id={`${idPrefix}-parent`}
            value={values.parentId}
            disabled={disabled || parentLock !== null}
            aria-describedby={`${idPrefix}-parent-hint`}
            onChange={(event) => set({ parentId: event.target.value })}
            className={inputClass}
          >
            <option value="">— หมวดระดับบนสุด —</option>
            {roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
          <p id={`${idPrefix}-parent-hint`} className="mt-1 text-xs text-muted">
            {parentLock ?? "ซ้อนได้ 2 ชั้น — หน้าร้านกรองสินค้าได้แค่หมวดแม่กับหมวดย่อยชั้นเดียว"}
          </p>
        </div>
      )}

      {kind === "colors" && (
        <div>
          <label htmlFor={`${idPrefix}-hex`} className="text-sm font-semibold">
            ค่าสี
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="color"
              aria-label="เลือกสีจากจานสี"
              value={/^#[0-9A-Fa-f]{6}$/.test(values.hex) ? values.hex : "#000000"}
              disabled={disabled}
              onChange={(event) => set({ hex: event.target.value.toUpperCase() })}
              className="h-11 w-14 shrink-0 cursor-pointer rounded-[12px] border border-line bg-white"
            />
            <input
              id={`${idPrefix}-hex`}
              value={values.hex}
              maxLength={7}
              disabled={disabled}
              onChange={(event) => set({ hex: event.target.value })}
              className="min-h-11 w-full min-w-0 rounded-[12px] border border-line bg-white px-3 font-mono text-sm outline-none focus:border-brand-soft"
            />
          </div>
        </div>
      )}

      {(kind === "categories" || kind === "brands") && (
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-description`} className="text-sm font-semibold">
            คำอธิบาย <span className="font-normal text-muted">(ไม่บังคับ)</span>
          </label>
          <input
            id={`${idPrefix}-description`}
            value={values.description}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => set({ description: event.target.value })}
            className={inputClass}
          />
        </div>
      )}
    </div>
  );
}
