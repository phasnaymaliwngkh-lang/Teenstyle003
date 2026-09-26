"use client";

import { Download, FileSpreadsheet, Layers } from "lucide-react";
import { useState } from "react";

import { ExportPanel } from "./export-panel";
import { InventoryImportPanel } from "./inventory-import-panel";
import { ProductImportPanel } from "./product-import-panel";

type TabKey = "export" | "products" | "inventory";

interface ImportExportTabsProps {
  initialTab?: TabKey;
}

export function ImportExportTabs({ initialTab = "export" }: ImportExportTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const tabs = [
    {
      key: "export" as const,
      label: "ส่งออกข้อมูล (Export)",
      icon: <Download className="size-4" />,
      description: "ดาวน์โหลดข้อมูลสินค้า, คลังสินค้า และคำสั่งซื้อ เป็น CSV หรือ Excel",
    },
    {
      key: "products" as const,
      label: "นำเข้าสินค้า (Import Products)",
      icon: <FileSpreadsheet className="size-4" />,
      description: "เพิ่มสินค้าและตัวเลือกใหม่เป็นชุดผ่านไฟล์ CSV หรือ Excel",
    },
    {
      key: "inventory" as const,
      label: "ปรับสต็อกเป็นชุด (Stock Take)",
      icon: <Layers className="size-4" />,
      description: "ตรวจนับสต็อก รับเข้า หรือตัดออกเป็นชุด พร้อมตรวจสอบความปลอดภัย",
    },
  ];

  return (
    <div className="space-y-6">
      {/* แท็บเมนู */}
      <div className="flex flex-wrap gap-2 border-b border-line pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition ${
              activeTab === tab.key
                ? "bg-brand text-white shadow-[var(--shadow-brand)]"
                : "border border-line bg-white text-muted hover:border-brand-soft hover:bg-lilac-50 hover:text-brand-dark"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* เนื้อหาแต่ละแท็บ */}
      {activeTab === "export" && <ExportPanel />}
      {activeTab === "products" && <ProductImportPanel />}
      {activeTab === "inventory" && <InventoryImportPanel />}
    </div>
  );
}
