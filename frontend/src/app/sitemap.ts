import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";
import { fetchShopFilters, searchLooks, searchShopProducts } from "@/services/catalog.service";

/**
 * sitemap.xml (STEP 33)
 *
 * เนื้อหามาจาก **ฐานข้อมูลจริงผ่าน API** ไม่ใช่รายการที่พิมพ์ไว้ในโค้ด
 * (บทเรียนจาก STEP 29: รายการที่คนดูแลด้วยมือจะเพี้ยนเงียบ ๆ — `GET /api` เคยประกาศว่า
 *  /api/inventory ยังไม่มี ทั้งที่เปิดใช้มาตั้งแต่ STEP 15)
 *
 * ⚠️ **ไม่ใส่ `lastModified` โดยเจตนา** — DTO ของรายการสินค้า/ลุคยังไม่ส่ง `updatedAt` มา
 *    การใส่ `new Date()` ให้ทุก URL คือการบอก Google ว่า "ทุกหน้าเพิ่งแก้เมื่อกี้" ทุกครั้งที่
 *    มีคนโหลด sitemap ซึ่งไม่จริง และเมื่อไม่จริงซ้ำ ๆ Google จะเลิกเชื่อค่านี้ทั้งเว็บ
 *    (`changeFrequency` / `priority` ก็ไม่ใส่ — Google ประกาศชัดว่าไม่ใช้สองค่านี้)
 *    ถ้าจะใส่ ต้องเพิ่ม `updatedAt` ลง DTO ของรายการก่อน แล้วค่อยกลับมาแก้ที่นี่
 *
 * ⚠️ **ต้องไม่มี URL ที่ noindex หรือถูก Disallow อยู่ในไฟล์นี้** — การส่ง URL ที่เราเองสั่งห้าม
 *    เก็บดัชนีให้ Google คือการขัดกันเอง (Search Console รายงานเป็น error)
 *    มีเทสต์เทียบรายการนี้กับ disallow ใน robots.ts ทีละเส้นทาง
 *
 * ⚠️ endpoint รายการจำกัด `limit` (สินค้า 48 · ลุค 24 ต่อหน้า) จึงต้องวนหลายหน้า
 *    ถ้าแคตตาล็อกโตถึงหลักหมื่น ต้องเปลี่ยนไปทำ sitemap index + endpoint ที่ส่งเฉพาะ slug
 */

const PRODUCTS_PER_PAGE = 48;
const LOOKS_PER_PAGE = 24;
/** กันลูปไม่รู้จบถ้า API ตอบ total เพี้ยน */
const MAX_PAGES = 50;

/** หน้าคงที่ที่เปิดให้เก็บดัชนี — ต้องตรงกับ metadata ของหน้านั้น (หน้าที่ noindex ห้ามอยู่ในนี้) */
const STATIC_PATHS = [
  "/",
  "/shop",
  "/looks",
  "/faq",
  "/customer-service",
  "/ai-stylist",
  "/about",
] as const;

async function collectProductSlugs(): Promise<string[]> {
  const slugs: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page: String(page), limit: String(PRODUCTS_PER_PAGE) });
    const result = await searchShopProducts(params);

    slugs.push(...result.items.map((item) => item.slug));

    if (slugs.length >= result.total || result.items.length === 0) break;
  }

  return slugs;
}

async function collectLookSlugs(): Promise<string[]> {
  const slugs: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ page: String(page), limit: String(LOOKS_PER_PAGE) });
    const result = await searchLooks(params);

    slugs.push(...result.items.map((item) => item.slug));

    if (slugs.length >= result.total || result.items.length === 0) break;
  }

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls: string[] = STATIC_PATHS.map((path) => absoluteUrl(path));

  /*
   * ถ้า API ล่ม ให้ส่ง sitemap ที่มีแต่หน้าคงที่ **ไม่ใช่โยน error**
   * sitemap ที่ตอบ 500 ทำให้ Google ทิ้งไฟล์ทั้งไฟล์ ซึ่งแย่กว่าไฟล์ที่ยังไม่ครบ
   */
  try {
    const [productSlugs, lookSlugs, filters] = await Promise.all([
      collectProductSlugs(),
      collectLookSlugs(),
      fetchShopFilters(),
    ]);

    urls.push(...productSlugs.map((slug) => absoluteUrl(`/product/${slug}`)));
    urls.push(...lookSlugs.map((slug) => absoluteUrl(`/looks/${slug}`)));

    /*
     * หน้าหมวดหมู่ = /shop?category=<slug> ซึ่งเป็น canonical ของหมวดนั้น (ดู lib/seo.ts)
     * หมวดที่ยังไม่มีสินค้าไม่ส่งเข้า sitemap — ส่ง URL ที่เปิดมาแล้วว่างเปล่าให้ Google
     * คือการขอให้เก็บดัชนีหน้าที่ไม่มีเนื้อหา (thin content)
     */
    urls.push(
      ...filters.categories
        .filter((category) => category.productCount > 0)
        .map((category) => absoluteUrl(`/shop?category=${category.slug}`)),
    );
  } catch {
    // ตั้งใจกลืน error — หน้าคงที่ยังส่งออกไปได้
  }

  return urls.map((url) => ({ url }));
}
