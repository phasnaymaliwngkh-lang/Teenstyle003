"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { downloadAdminLogs } from "@/services/admin.service";
import type { FileFormat } from "@/types/admin";

/**
 * ดาวน์โหลดประวัติของช่วง/ตัวกรองที่กำลังดูอยู่ (STEP 27)
 *
 * ⚠️ ส่ง query เดียวกับที่หน้ากำลังแสดง เพื่อให้ไฟล์ตรงกับสิ่งที่เห็นบนจอ
 * ⚠️ ไฟล์มี IP และ User-Agent ของพนักงาน — บอกไว้บนหน้าจอว่าเป็นข้อมูลส่วนบุคคล
 */
export function LogExportButton({ query }: { query: string }) {
  const [pending, setPending] = useState<FileFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: FileFormat) => {
    setPending(format);
    setError(null);

    try {
      await downloadAdminLogs(query, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดาวน์โหลดไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {(["xlsx", "csv"] as const).map((format) => (
          <button
            key={format}
            type="button"
            disabled={pending !== null}
            onClick={() => void run(format)}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
          >
            {pending === format ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {format === "xlsx" ? "Excel" : "CSV"}
          </button>
        ))}
      </div>

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
