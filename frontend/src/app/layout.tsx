import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";

import { JsonLd } from "@/components/shared/json-ld";
import { publicEnv } from "@/lib/env";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo";

import "./globals.css";

/** หัวข้อ / ภาษาอังกฤษ */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/** เนื้อหาภาษาไทย */
const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: "TeenStyle ✧ — Find your style, be you 💜",
    template: "%s | TeenStyle ✧",
  },
  description:
    "TEENSTYLE AI ร้านค้าออนไลน์แฟชั่นวัยรุ่น เสื้อผ้าหลากหลายสไตล์ พร้อม AI Stylist ช่วยแนะนำการแต่งตัว และ AI Customer Service ตอบทุกคำถาม",
  applicationName: "TEENSTYLE AI",
  /*
   * ⚠️ **ห้ามใส่ `title` / `description` ใน openGraph ที่ระดับ root** (แก้ตอน STEP 33)
   *
   * Next จะเติม og:title/og:description จาก title/description ของ "หน้านั้น ๆ" ให้เอง
   * **เฉพาะเมื่อไม่ได้ประกาศไว้ที่นี่** — เดิมประกาศไว้ ทำให้ทุกหน้าในเว็บแชร์ออกไป
   * เป็นการ์ดเดียวกันหมด ("Find your style, be you") ไม่ว่าจะแชร์หน้าสินค้าหรือหน้าลุค
   */
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "TEENSTYLE AI",
  },
  twitter: {
    // ไม่ต้องใส่ image เอง — Twitter/X ใช้ og:image ที่ opengraph-image.tsx สร้างให้
    card: "summary_large_image",
  },
  /*
   * ไม่ใส่ `keywords` โดยเจตนา — Google ประกาศเลิกใช้ meta keywords มาตั้งแต่ปี 2009
   * ใส่ไว้ได้แค่หลอกตัวเองว่าทำ SEO แล้ว
   */
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${jakarta.variable} ${notoThai.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* structured data ของตัวตนร้าน — ใส่ครั้งเดียวทั้งเว็บ (STEP 33) */}
        <JsonLd data={[organizationJsonLd(), webSiteJsonLd()]} />
        {children}
      </body>
    </html>
  );
}
