import type { Metadata } from "next";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";

import { StylistChat } from "@/features/ai-stylist/components/stylist-chat";

export const metadata: Metadata = {
  title: "AI Stylist — ให้ AI ช่วยเลือกชุด | TEENSTYLE AI",
  description:
    "บอกสไตล์ สี โอกาสใช้งาน และงบประมาณ แล้วให้ AI Stylist แนะนำสินค้าจริงจากฐานข้อมูลที่เหมาะกับคุณ ไม่แต่งข้อมูลปลอม",
};

export default function AiStylistPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      {/* Header Banner */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-lilac-100 px-3.5 py-1 text-xs font-bold text-brand uppercase tracking-wider">
          <Sparkles className="size-3.5" aria-hidden />
          STEP 19 · AI Stylist
        </div>

        <h1 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
          AI Stylist ผู้ช่วยเลือกสไตล์ส่วนตัว
        </h1>

        <p className="mt-2 text-sm text-muted-light sm:text-base">
          ไม่รู้จะแมตช์ชุดอย่างไร? ให้สไตลิสต์ช่วยคิด
          แนะนำจากสินค้าที่มีจำหน่ายและมีสต็อกจริงในร้านเท่านั้น
        </p>

        {/* Guarantee Badges */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-muted-light">
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-4 text-brand" aria-hidden />
            สินค้ามีอยู่จริงในร้าน 100%
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            สต็อกและราคาตรงตามจริงเสมอ
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="size-4 text-warning" aria-hidden />
            แนะนำลุคพร้อมใส่ตะกร้าได้ทันที
          </span>
        </div>
      </div>

      {/* Main Interactive Chat */}
      <StylistChat />
    </div>
  );
}
