import type { Metadata } from "next";

import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "AI Stylist — ให้ AI ช่วยเลือกชุด",
  description: "บอกสไตล์ สี โอกาสใช้งาน และงบประมาณ แล้วให้ AI Stylist แนะนำสินค้าที่เหมาะกับคุณ",
};

export default function AiStylistPage() {
  return (
    <ComingSoon
      title="AI Stylist ✧"
      step={19}
      description="ผู้ช่วยแต่งตัวที่ถามความต้องการแล้วแนะนำสินค้าจริงจากฐานข้อมูล ไม่ได้แต่งข้อมูลขึ้นเอง"
      items={[
        "ถามสไตล์ สี โอกาสใช้งาน งบประมาณ และไซซ์",
        "ค้นหาสินค้าจริงจากฐานข้อมูลผ่าน backend — ราคาและสต็อกตรงกับของจริงเสมอ",
        "ถ้าไม่พบสินค้าที่ตรงเงื่อนไข จะแจ้งว่าไม่พบ ไม่สร้างข้อมูลปลอม",
        "บันทึกบทสนทนาไว้ตรวจย้อนหลังได้ว่าอ้างอิงสินค้าใด",
      ]}
    />
  );
}
