"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { downloadAnalyticsReport } from "@/services/admin.service";
import type { FileFormat } from "@/types/admin";

/**
 * ปุ่มดาวน์โหลดรายงานของช่วงที่กำลังดูอยู่ (STEP 26)
 *
 * ⚠️ ส่ง query เดียวกับที่หน้ากำลังแสดง เพื่อให้ **ไฟล์ตรงกับสิ่งที่เห็นบนจอเสมอ**
 *    ถ้าปล่อยให้ปุ่มดาวน์โหลด "ช่วงเริ่มต้น" ขณะที่หน้าจอแสดงอีกช่วง
 *    คนจะเอาไฟล์ไปใช้แล้วสงสัยว่าทำไมตัวเลขไม่ตรงกัน
 *
 * ⚠️ CSV เก็บได้ชีตเดียว จึงได้เฉพาะตารางรายช่วงเวลา — บอกไว้บนปุ่มเลย
 */
export function AnalyticsExportButton({ query }: { query: string }) {
  const [pending, setPending] = useState<FileFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: FileFormat) => {
    setPending(format);
    setError(null);

    try {
      await downloadAnalyticsReport(query, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดาวน์โหลดรายงานไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void run("xlsx")}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
        >
          {pending === "xlsx" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          Excel (ครบทุกตาราง)
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void run("csv")}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
        >
          {pending === "csv" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Download className="size-4" aria-hidden />
          )}
          CSV (เฉพาะตารางรายช่วง)
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
