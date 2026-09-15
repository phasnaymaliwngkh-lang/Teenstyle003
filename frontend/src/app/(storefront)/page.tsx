import type { Metadata } from "next";
import { Suspense } from "react";

import { SectionLoading } from "@/components/shared/section";
import { AiStylistSection } from "@/features/home/components/ai-stylist-section";
import { CategoriesSection } from "@/features/home/components/categories-section";
import { Hero } from "@/features/home/components/hero";
import { LooksSection } from "@/features/home/components/looks-section";
import { ProductSection } from "@/features/home/components/product-section";

export const metadata: Metadata = {
  title: "TeenStyle ✧ — Find your style, be you 💜",
  description:
    "ร้านค้าออนไลน์แฟชั่นวัยรุ่น เสื้อผ้าหลากหลายสไตล์ พร้อม AI Stylist ช่วยแนะนำการแต่งตัว และ AI Customer Service ตอบทุกคำถาม",
};

/**
 * หน้าแรก (STEP 5)
 *
 * ทุก section ที่มีข้อมูลดึงจาก REST API จริง → ฐานข้อมูล PostgreSQL
 * แต่ละ section ห่อด้วย <Suspense> แยกกัน จึงสตรีมออกมาทีละส่วน
 * ส่วนที่ช้าหรือพังไม่ฉุดให้ทั้งหน้ารอหรือพังไปด้วย
 *
 * 4 สถานะครบทุก section (STEP 32):
 *   Loading → fallback ของ Suspense (SectionLoading)
 *   Error   → SectionError + ปุ่มลองอีกครั้ง
 *   Empty   → SectionEmpty
 *   Success → ข้อมูลจริง
 */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />

      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16 px-4 pb-20 sm:px-6">
        <Suspense fallback={<SectionLoading title="สินค้ามาใหม่" />}>
          <ProductSection
            eyebrow="New Arrivals"
            title="สินค้ามาใหม่"
            subtitle="สินค้าที่เพิ่งเข้าร้าน เรียงจากใหม่สุด"
            sort="newest"
            limit={4}
            action={{ label: "ดูทั้งหมด", href: "/shop" }}
            emptyMessage="ยังไม่มีสินค้าที่เผยแพร่"
            emptyHint="เพิ่มสินค้าในระบบหลังบ้าน หรือรัน npm run db:seed เพื่อใส่ข้อมูลตั้งต้น"
          />
        </Suspense>

        <Suspense fallback={<SectionLoading title="Flash Sale" />}>
          <ProductSection
            eyebrow="Flash Sale"
            title="ลดราคาอยู่ตอนนี้"
            subtitle="เรียงจากส่วนลดมากไปน้อย — คิดจากราคาจริงในฐานข้อมูล"
            sort="discount"
            limit={4}
            action={{ label: "ดูทั้งหมด", href: "/shop" }}
            emptyMessage="ยังไม่มีสินค้าลดราคา"
            emptyHint="ตั้งราคาลด (salePrice) ให้สินค้าในระบบหลังบ้าน แล้วจะแสดงที่นี่อัตโนมัติ"
          />
        </Suspense>

        <Suspense fallback={<SectionLoading title="สินค้าขายดี" />}>
          <ProductSection
            eyebrow="Best Sellers"
            title="สินค้าขายดี"
            subtitle="นับจากจำนวนที่ขายได้จริงในคำสั่งซื้อที่ชำระเงินแล้ว"
            sort="bestselling"
            limit={4}
            emptyMessage="ยังไม่มีข้อมูลยอดขาย"
            emptyHint="ส่วนนี้จะแสดงสินค้าที่ขายได้จริงเมื่อมีคำสั่งซื้อที่ชำระเงินแล้ว (STEP 10–11) — ตอนนี้ยังไม่มีคำสั่งซื้อในระบบ จึงไม่แสดงข้อมูลใด ๆ แทนการเดา"
          />
        </Suspense>

        <Suspense fallback={<SectionLoading title="เลือกตามหมวดหมู่" count={6} />}>
          <CategoriesSection />
        </Suspense>

        <Suspense fallback={<SectionLoading title="แนะนำสำหรับคุณ" />}>
          <ProductSection
            eyebrow="Recommended"
            title="แนะนำสำหรับคุณ"
            subtitle="จัดอันดับจากจำนวนคนที่กดถูกใจและการเข้าชมสินค้า — การแนะนำเฉพาะบุคคลตามประวัติของคุณจะเปิดใน STEP 46"
            sort="popular"
            limit={4}
            action={{ label: "ดูทั้งหมด", href: "/shop" }}
            emptyMessage="ยังไม่มีสินค้าให้แนะนำ"
            emptyHint="เมื่อมีสินค้าในระบบ ส่วนนี้จะจัดอันดับให้อัตโนมัติ"
          />
        </Suspense>

        <AiStylistSection />

        <Suspense fallback={<SectionLoading title="Look ที่ได้รับความนิยม" />}>
          <LooksSection />
        </Suspense>
      </div>
    </main>
  );
}
