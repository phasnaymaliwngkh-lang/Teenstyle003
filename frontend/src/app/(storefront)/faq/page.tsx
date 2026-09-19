import type { Metadata } from "next";
import { HelpCircle, Sparkles, BookOpen, ShieldCheck } from "lucide-react";

import { FaqViewer } from "@/features/knowledge/components/faq-viewer";

export const metadata: Metadata = {
  title: "คำถามที่พบบ่อย (FAQ) & ศูนย์ความรู้ AI | TEENSTYLE AI",
  description:
    "ศูนย์รวมคำถามที่พบบ่อย นโยบายการจัดส่ง การเปลี่ยนไซซ์คืนสินค้า และการดูแลรักษาเนื้อผ้า พร้อมผู้ช่วย AI ตอบคำถามจากคลังความรู้จริง 100%",
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Top Banner Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-lilac px-3.5 py-1 text-xs font-bold text-brand-dark uppercase tracking-wider">
          <BookOpen className="size-3.5" aria-hidden />
          STEP 21 · AI Knowledge Base & ศูนย์ความรู้
        </div>

        <h1 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
          ศูนย์ช่วยเหลือ & คำถามที่พบบ่อย 📚
        </h1>

        <p className="mt-2 text-sm text-muted sm:text-base max-w-xl mx-auto">
          ค้นหาคำตอบอย่างรวดเร็ว ครอบคลุมเรื่องค่าส่ง การเปลี่ยนคืน การชำระเงิน และการดูแลเสื้อผ้า
          พร้อมผู้ช่วย AI ค้นคืนข้อมูลจากคลังความรู้อย่างแม่นยำ
        </p>

        {/* Feature Highlights */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-muted">
          <span className="flex items-center gap-1">
            <Sparkles className="size-4 text-brand" aria-hidden />
            ถาม AI สังเคราะห์คำตอบตรงจุด
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-4 text-success" aria-hidden />
            ข้อมูลอ้างอิงนโยบายร้านจริง 100%
          </span>
          <span className="flex items-center gap-1">
            <HelpCircle className="size-4 text-brand" aria-hidden />
            อัปเดตบทความและคู่มือสม่ำเสมอ
          </span>
        </div>
      </div>

      {/* Main Interactive FAQ & Knowledge Explorer */}
      <FaqViewer />
    </div>
  );
}
