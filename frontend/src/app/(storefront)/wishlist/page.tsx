import type { Metadata } from "next";

import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "Wishlist — รายการที่ถูกใจ",
};

export default function WishlistPage() {
  return (
    <ComingSoon
      title="Wishlist"
      step={22}
      description="เก็บสินค้าที่ถูกใจไว้ดูทีหลัง และแจ้งเตือนเมื่อราคาลดลง"
      items={[
        "เพิ่ม ลบ และดูรายการที่ถูกใจ",
        "แสดงราคาและสถานะสต็อกล่าสุด",
        "แจ้งเตือนเมื่อราคาต่ำกว่าตอนที่กดถูกใจ (ฐานข้อมูลเก็บ priceWhenAdded ไว้แล้ว)",
        "ย้ายจาก Wishlist เข้าตะกร้าได้ทันที",
      ]}
    />
  );
}
