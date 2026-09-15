import type { Metadata } from "next";

import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = {
  title: "ค้นหาสินค้า",
};

export default function SearchPage() {
  return (
    <ComingSoon
      title="ค้นหาสินค้า"
      step={45}
      description="ค้นหาแบบพิมพ์เป็นภาษาคนได้ เช่น “เสื้อสีดำราคาไม่เกิน 500 บาท” แล้ว backend แปลงเป็นเงื่อนไขกรอง"
      items={[
        "Autocomplete, คำค้นแนะนำ และประวัติการค้นหา",
        "กรองตามราคา ไซซ์ สี หมวดหมู่ แบรนด์ สไตล์ และสต็อก",
        "ค้นหาข้อความแบบเร็วด้วย GIN index + pg_trgm ที่สร้างไว้แล้วใน STEP 2",
        "ผลลัพธ์อ้างอิงสินค้าจริงเท่านั้น",
      ]}
    />
  );
}
