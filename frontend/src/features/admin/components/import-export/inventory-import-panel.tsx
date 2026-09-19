"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { downloadAdminTemplate, importAdminInventory } from "@/services/admin.service";
import type { FileFormat, InventoryImportResult } from "@/types/admin";

export function InventoryImportPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [result, setResult] = useState<InventoryImportResult | null>(null);

  const handleDownloadTemplate = async (format: FileFormat) => {
    try {
      setTemplateLoading(format);
      await downloadAdminTemplate("inventory", format);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "ดาวน์โหลดแม่แบบไม่สำเร็จ");
    } finally {
      setTemplateLoading(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setResult(null);
      setGeneralError(null);
    }
  };

  const handleImport = async (dryRun: boolean) => {
    if (!selectedFile) {
      setGeneralError("กรุณาเลือกไฟล์ที่ต้องการนำเข้าก่อน");
      return;
    }

    try {
      setLoading(true);
      setGeneralError(null);
      const res = await importAdminInventory(selectedFile, dryRun);
      setResult(res);
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผลไฟล์");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ส่วนดาวน์โหลดแม่แบบ */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-lilac-50/60 p-5">
        <div>
          <h3 className="text-sm font-bold text-ink">ดาวน์โหลดแม่แบบตรวจนับสต็อก (Template)</h3>
          <p className="text-xs text-muted">
            ระบุ SKU หรือบาร์โค้ด, ประเภทการปรับ (ADJUSTMENT, STOCK_IN, STOCK_OUT), จำนวน และเหตุผล
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={templateLoading !== null}
            onClick={() => handleDownloadTemplate("xlsx")}
            className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:border-brand-soft hover:bg-lilac-50"
          >
            {templateLoading === "xlsx" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5 text-brand" />
            )}
            แม่แบบ Excel (.xlsx)
          </button>
          <button
            type="button"
            disabled={templateLoading !== null}
            onClick={() => handleDownloadTemplate("csv")}
            className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4 py-2 text-xs font-semibold text-ink transition hover:border-brand-soft hover:bg-lilac-50"
          >
            {templateLoading === "csv" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5 text-brand" />
            )}
            แม่แบบ CSV (.csv)
          </button>
        </div>
      </div>

      {generalError && (
        <div
          className="rounded-[var(--radius-card)] border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
          role="alert"
        >
          {generalError}
        </div>
      )}

      {/* กล่องเลือกไฟล์ */}
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
          onChange={handleFileChange}
          className="hidden"
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-lilac-50/30 p-8 text-center transition hover:border-brand-soft hover:bg-lilac-50/60"
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-lilac text-brand">
            <Upload className="size-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">
            {selectedFile
              ? selectedFile.name
              : "คลิกเพื่อเลือกไฟล์ตรวจนับสต็อก หรือลากไฟล์มาวางที่นี่"}
          </p>
          <p className="mt-1 text-xs text-muted">
            รองรับไฟล์ Excel (.xlsx) และ CSV (.csv) ขนาดไม่เกิน 5MB
          </p>
          {selectedFile && (
            <span className="mt-2 rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-xs font-bold text-brand-dark">
              ขนาด {(selectedFile.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            disabled={!selectedFile || loading}
            onClick={() => handleImport(true)}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4 text-brand" />
            )}
            ตรวจสอบยอดตรวจนับ (Dry Run)
          </button>
          <button
            type="button"
            disabled={!selectedFile || loading || (result !== null && result.errorCount > 0)}
            onClick={() => handleImport(false)}
            className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            บันทึกการปรับสต็อกจริง
          </button>
        </div>
      </div>

      {/* แสดงผลการตรวจสอบ / ผลลัพธ์ */}
      {result && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-3">
              {result.errorCount === 0 ? (
                <CheckCircle2 className="size-6 text-success" />
              ) : (
                <AlertCircle className="size-6 text-danger" />
              )}
              <div>
                <h4 className="text-base font-bold text-ink">
                  {result.dryRun
                    ? result.errorCount === 0
                      ? "การตรวจสอบสำเร็จ — ยอดสต็อกพร้อมปรับปรุง"
                      : "พบข้อผิดพลาดในรายการตรวจนับ"
                    : "ปรับปรุงยอดสต็อกสำเร็จ"}
                </h4>
                <p className="text-xs text-muted">
                  {result.dryRun
                    ? "นี่คือการตรวจสอบผลต่างสต็อกเบื้องต้น (ยังไม่ได้บันทึกลงฐานข้อมูลจริง)"
                    : `ปรับยอดสต็อกสำเร็จทั้งสิ้น ${result.adjustedCount ?? 0} รายการ`}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="rounded-lg bg-lilac-50 px-3 py-1.5 text-xs font-semibold text-muted">
                ทั้งหมด {result.totalRows} แถว
              </span>
              <span className="rounded-lg bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                ผ่าน {result.validCount} แถว
              </span>
              {result.errorCount > 0 && (
                <span className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger">
                  ผิดพลาด {result.errorCount} แถว
                </span>
              )}
            </div>
          </div>

          {/* ตาราง Error */}
          {result.errors.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-danger/30 bg-white p-5 shadow-[var(--shadow-soft)]">
              <h4 className="text-sm font-bold text-danger">รายการข้อผิดพลาดที่ต้องแก้ไข</h4>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line bg-danger/5 text-muted">
                    <tr>
                      <th className="px-3 py-2">แถวที่</th>
                      <th className="px-3 py-2">SKU / บาร์โค้ด</th>
                      <th className="px-3 py-2">คอลัมน์ (Field)</th>
                      <th className="px-3 py-2">รายละเอียดข้อผิดพลาด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.errors.map((err, i) => (
                      <tr key={i} className="hover:bg-danger/5">
                        <td className="px-3 py-2 font-bold text-ink">{err.row}</td>
                        <td className="px-3 py-2 font-mono text-muted">{err.sku ?? "-"}</td>
                        <td className="px-3 py-2 font-mono text-muted">{err.field ?? "-"}</td>
                        <td className="px-3 py-2 text-danger">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ตาราง Preview ยอดสต็อกก่อนและหลัง */}
          {result.preview && result.preview.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
              <h4 className="text-sm font-bold text-ink">
                สรุปผลต่างและยอดสต็อกที่จะปรับ ({result.preview.length} รายการ)
              </h4>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line bg-lilac-50/50 text-muted">
                    <tr>
                      <th className="px-3 py-2">แถว</th>
                      <th className="px-3 py-2">SKU / บาร์โค้ด</th>
                      <th className="px-3 py-2">ชื่อสินค้า</th>
                      <th className="px-3 py-2">ประเภท</th>
                      <th className="px-3 py-2">ยอดปัจจุบัน</th>
                      <th className="px-3 py-2">จองไว้</th>
                      <th className="px-3 py-2">ผลต่าง (Delta)</th>
                      <th className="px-3 py-2">ยอดหลังปรับ</th>
                      <th className="px-3 py-2">สถานะ</th>
                      <th className="px-3 py-2">เหตุผล</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.preview.map((row, i) => (
                      <tr
                        key={i}
                        className={`hover:bg-lilac-50/20 ${row.status === "INVALID" ? "bg-danger/5" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono text-muted">{row.row}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-ink">{row.sku}</td>
                        <td className="px-3 py-2 text-ink">{row.productName}</td>
                        <td className="px-3 py-2 font-mono text-muted">{row.type}</td>
                        <td className="px-3 py-2 font-bold text-ink">{row.currentQuantity}</td>
                        <td className="px-3 py-2 text-muted">{row.reservedQuantity}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`font-bold ${
                              row.delta > 0
                                ? "text-success"
                                : row.delta < 0
                                  ? "text-danger"
                                  : "text-muted"
                            }`}
                          >
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-extrabold text-brand-dark">
                          {row.newQuantity}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              row.status === "VALID"
                                ? "bg-success/15 text-success"
                                : "bg-danger/15 text-danger"
                            }`}
                          >
                            {row.status === "VALID" ? "ถูกต้อง" : "ไม่ผ่าน"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
