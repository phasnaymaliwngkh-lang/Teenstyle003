import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

/**
 * robots.txt (STEP 33)
 *
 * ⚠️ `Disallow` **ไม่ใช่การป้องกันความปลอดภัย** — มันเป็นคำขอต่อบ็อตที่สุภาพเท่านั้น
 *    ด่านจริงของเส้นทางเหล่านี้คือ `requireUser`/`requireStaff` ใน DAL และ RBAC ที่ backend
 *    ที่ใส่ไว้เพราะไม่มีประโยชน์ที่จะให้บ็อตไปกดหน้าที่ต้องล็อกอิน (ได้แต่ redirect)
 *    แล้วเปลืองงบ crawl ของเว็บไปกับหน้าที่ไม่มีวันขึ้นผลการค้นหา
 *
 * ⚠️ หน้าที่ต้องการให้ "ไม่ขึ้นดัชนี" ต้องใส่ `robots: noindex` ใน metadata ของหน้าด้วย
 *    เพราะหน้าที่ถูก Disallow ยัง **ขึ้นดัชนีได้** ถ้ามีเว็บอื่นลิงก์มา (Google เก็บ URL ไว้
 *    โดยไม่อ่านเนื้อหา) — ส่วนหน้าที่ถูก Disallow แล้ว Google จะ **อ่าน noindex ไม่เจอ** ด้วย
 *    จึงต้องเลือกอย่างใดอย่างหนึ่งให้ถูกกับเจตนา ดูตารางใน CLAUDE.md หัวข้อ SEO
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin", // หลังบ้าน — ต้องเป็นพนักงานเท่านั้น
          "/account", // ข้อมูลส่วนตัวของลูกค้า
          "/api/", // route handler ของ Next (auth + รวมตะกร้า)
          "/cart",
          "/checkout",
          "/wishlist",
          "/signin",
          "/after-signin",
          "/forbidden",
          "/unauthorized",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
