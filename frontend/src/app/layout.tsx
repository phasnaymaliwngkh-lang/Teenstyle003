import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai, Plus_Jakarta_Sans } from "next/font/google";

import { publicEnv } from "@/lib/env";

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
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: "TEENSTYLE AI",
    title: "TeenStyle ✧ — Find your style, be you 💜",
    description: "ค้นหาสไตล์ที่ใช่สำหรับคุณ พร้อมคำแนะนำแฟชั่นจาก AI",
  },
  // STEP 33 จะเพิ่ม keywords, Twitter card, structured data และ sitemap
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${jakarta.variable} ${notoThai.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
