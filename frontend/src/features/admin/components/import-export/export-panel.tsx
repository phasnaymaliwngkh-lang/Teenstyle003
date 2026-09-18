"use client";

import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { downloadAdminExport } from "@/services/admin.service";
import type { FileFormat } from "@/types/admin";

export function ExportPanel() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Products filters
  const [productFormat, setProductFormat] = useState<FileFormat>("xlsx");
  const [productStatus, setProductStatus] = useState("ALL");

  // Inventory filters
  const [inventoryFormat, setInventoryFormat] = useState<FileFormat>("xlsx");
  const [inventoryStockStatus, setInventoryStockStatus] = useState("ALL");

  // Orders filters
  const [orderFormat, setOrderFormat] = useState<FileFormat>("xlsx");
  const [orderStatus, setOrderStatus] = useState("ALL");

  const handleExport = async (
    type: "products" | "inventory" | "orders",
    format: FileFormat,
    query = "",
  ) => {
    try {
      setLoading(type);
      setError(null);
      await downloadAdminExport(type, format, query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการส่งออกไฟล์");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded-[var(--radius-card)] border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Card 1: ข้อมูลสินค้า */}
        <div className="flex flex-col justify-between rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-lilac text-brand">
                <FileSpreadsheet className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">ข้อมูลสินค้าและตัวเลือก</h3>
                <p className="text-xs text-muted">ราคา, หมวดหมู่, สี, ไซซ์, บาร์โค้ด</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted uppercase">รูปแบบไฟล์</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setProductFormat("xlsx")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      productFormat === "xlsx"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductFormat("csv")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      productFormat === "csv"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileText className="size-3.5" />
                    CSV (.csv)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted uppercase">สถานะสินค้า</label>
                <select
                  value={productStatus}
                  onChange={(e) => setProductStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                >
                  <option value="ALL">ทุกสถานะ (ทั้งหมด)</option>
                  <option value="ACTIVE">เปิดขาย (ACTIVE)</option>
                  <option value="DRAFT">ฉบับร่าง (DRAFT)</option>
                  <option value="ARCHIVED">เก็บถาวร (ARCHIVED)</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading === "products"}
            onClick={() =>
              handleExport(
                "products",
                productFormat,
                productStatus !== "ALL" ? `status=${productStatus}` : "",
              )
            }
            className="btn-brand mt-6 flex w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {loading === "products" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            ดาวน์โหลดไฟล์สินค้า
          </button>
        </div>

        {/* Card 2: ข้อมูลคลังสินค้า */}
        <div className="flex flex-col justify-between rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-lilac text-brand">
                <FileSpreadsheet className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">รายงานสต็อกสินค้า</h3>
                <p className="text-xs text-muted">ยอดคงคลัง, จองไว้, ขายได้จริง, ที่เก็บ</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted uppercase">รูปแบบไฟล์</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInventoryFormat("xlsx")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      inventoryFormat === "xlsx"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventoryFormat("csv")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      inventoryFormat === "csv"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileText className="size-3.5" />
                    CSV (.csv)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted uppercase">สถานะสต็อก</label>
                <select
                  value={inventoryStockStatus}
                  onChange={(e) => setInventoryStockStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                >
                  <option value="ALL">ทุกสถานะ (ทั้งหมด)</option>
                  <option value="IN_STOCK">พร้อมส่ง (IN_STOCK)</option>
                  <option value="LOW_STOCK">สต็อกต่ำ (LOW_STOCK)</option>
                  <option value="OUT_OF_STOCK">สินค้าหมด (OUT_OF_STOCK)</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading === "inventory"}
            onClick={() =>
              handleExport(
                "inventory",
                inventoryFormat,
                inventoryStockStatus !== "ALL" ? `stockStatus=${inventoryStockStatus}` : "",
              )
            }
            className="btn-brand mt-6 flex w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {loading === "inventory" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            ดาวน์โหลดรายงานสต็อก
          </button>
        </div>

        {/* Card 3: คำสั่งซื้อ */}
        <div className="flex flex-col justify-between rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-lilac text-brand">
                <FileSpreadsheet className="size-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink">ประวัติคำสั่งซื้อ</h3>
                <p className="text-xs text-muted">ยอดชำระ, ที่อยู่, เลขพัสดุ, สถานะ</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted uppercase">รูปแบบไฟล์</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderFormat("xlsx")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      orderFormat === "xlsx"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFormat("csv")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold transition ${
                      orderFormat === "csv"
                        ? "border-brand bg-lilac/30 text-brand-dark"
                        : "border-line text-muted hover:border-brand-soft"
                    }`}
                  >
                    <FileText className="size-3.5" />
                    CSV (.csv)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted uppercase">
                  สถานะคำสั่งซื้อ
                </label>
                <select
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                >
                  <option value="ALL">ทุกสถานะ (ทั้งหมด)</option>
                  <option value="PENDING_PAYMENT">รอชำระเงิน</option>
                  <option value="PAID">ชำระเงินแล้ว</option>
                  <option value="PROCESSING">กำลังเตรียมจัดของ</option>
                  <option value="PACKING">แพ็กของแล้ว</option>
                  <option value="SHIPPING">กำลังจัดส่ง</option>
                  <option value="DELIVERED">จัดส่งสำเร็จ</option>
                  <option value="CANCELLED">ยกเลิกแล้ว</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading === "orders"}
            onClick={() =>
              handleExport(
                "orders",
                orderFormat,
                orderStatus !== "ALL" ? `status=${orderStatus}` : "",
              )
            }
            className="btn-brand mt-6 flex w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {loading === "orders" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            ดาวน์โหลดประวัติออเดอร์
          </button>
        </div>
      </div>
    </div>
  );
}
