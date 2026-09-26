import type { Metadata } from "next";

import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา",
  description: "ร้านค้าออนไลน์แฟชั่นสำหรับวัยรุ่น พร้อม AI Stylist และ AI Customer Service",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <ComingSoon
      title="เกี่ยวกับ TEENSTYLE AI"
      step={49}
      description="ข้อมูลร้านทั้งหมดจะถูกย้ายไปเก็บใน Store Settings เพื่อให้ผู้ดูแลแก้ได้เองโดยไม่ต้องแก้โค้ด"
      items={[
        "ชื่อร้าน โลโก้ คำอธิบาย และช่องทางติดต่อ",
        "นโยบายจัดส่ง คืนสินค้า ชำระเงิน และความเป็นส่วนตัว",
        "ลิงก์โซเชียลมีเดีย",
        "ตั้งค่ายอดสั่งซื้อขั้นต่ำและสกุลเงิน",
      ]}
    />
  );
}
