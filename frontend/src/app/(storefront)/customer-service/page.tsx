import type { Metadata } from "next";
import { CheckCircle2, Headphones, ShieldCheck, UserCheck } from "lucide-react";

import { CsChat } from "@/features/customer-service/components/cs-chat";

export const metadata: Metadata = {
  title: "ฝ่ายบริการลูกค้า — AI Customer Service & Human Handoff | TEENSTYLE AI",
  description:
    "สอบถามข้อมูลสินค้า เช็คสถานะคำสั่งซื้อ ค่าจัดส่ง และนโยบายการคืนสินค้า พร้อมระบบส่งต่อให้เจ้าหน้าที่คนจริงดูแลคุณทันที",
};

export default function CustomerServicePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      {/* Header Banner */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-lilac px-3.5 py-1 text-xs font-bold text-brand-dark uppercase tracking-wider">
          <Headphones className="size-3.5" aria-hidden />
          STEP 20 · Customer Service & Human Handoff
        </div>

        <h1 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
          ฝ่ายบริการลูกค้า TEENSTYLE 💜
        </h1>

        <p className="mt-2 text-sm text-muted sm:text-base max-w-xl mx-auto">
          ผู้ช่วย AI บริการตลอด 24 ชั่วโมง ตรวจสอบคำสั่งซื้อจริง
          และพร้อมส่งต่อให้เจ้าหน้าที่คนจริงดูแลคุณได้ทุกเมื่อ
        </p>

        {/* Guarantee Badges */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-muted">
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-4 text-brand" aria-hidden />
            เช็คสถานะพัสดุจากระบบจริง
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
            นโยบายเปลี่ยนคืนภายใน 7 วัน
          </span>
          <span className="flex items-center gap-1">
            <UserCheck className="size-4 text-amber-600" aria-hidden />
            ส่งต่อเจ้าหน้าที่คนจริงได้ทันที
          </span>
        </div>
      </div>

      {/* Main Interactive Chat */}
      <CsChat />
    </div>
  );
}
