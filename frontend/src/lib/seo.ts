import type { Metadata } from "next";

import { publicEnv } from "./env";

/**
 * ตัวช่วย SEO ทั้งหมดของโปรเจกต์ (STEP 33)
 *
 * ทุกฟังก์ชันในไฟล์นี้เป็น **ฟังก์ชันบริสุทธิ์** เพื่อให้เทสต์ยิงเข้าตรง ๆ ได้
 * (โครงสร้างข้อมูล JSON-LD ผิดแล้วไม่มีอะไรฟ้อง — หน้าเว็บยังแสดงปกติ
 *  แต่ Google อ่านไม่เข้าใจหรือเข้าใจผิด ซึ่งแย่กว่าไม่ใส่เลย)
 *
 * กฎที่ยึดตลอดไฟล์นี้: **ห้ามประกาศสิ่งที่ไม่มีจริง**
 *   - ไม่มีรีวิว → ไม่ใส่ `aggregateRating` (ไม่ใช่ใส่ 0 ดาว)
 *   - ยังไม่มีหน้าค้นหาที่ทำงานจริง → ไม่ประกาศ `SearchAction`
 *   - ยังไม่มีโปรไฟล์โซเชียลจริงของร้าน → ไม่ใส่ `sameAs`
 *   - ไม่รู้ว่าเนื้อหาแก้ครั้งสุดท้ายเมื่อไร → ไม่ใส่ `lastModified` ใน sitemap
 */

/** โดเมนของเว็บ (ไม่มี / ปิดท้าย) — มาจาก `NEXT_PUBLIC_SITE_URL` */
export const SITE_URL = publicEnv.siteUrl.replace(/\/+$/, "");

export const SITE_NAME = "TEENSTYLE AI";

/** ทำ path ให้เป็น URL เต็ม — ใช้กับ JSON-LD และ sitemap ที่ต้องใช้ URL สมบูรณ์เท่านั้น */
export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * สร้าง canonical จาก path + query ที่ "นับว่าเป็นหน้าคนละหน้าจริง ๆ" เท่านั้น
 *
 * ทำไมต้องกรอง: `/shop?sort=price-asc&color=black,white` คือ **สินค้าชุดเดิมที่เรียงใหม่**
 * ถ้าปล่อยให้ทุกคอมบิเนชันเป็น URL ของตัวเอง หน้าเดียวจะกลายเป็นหลายพันหน้าที่เนื้อหาซ้ำกัน
 * แล้ว Google จะเลือกเองว่าจะเก็บอันไหน (ซึ่งมักไม่ใช่อันที่เราต้องการ)
 *
 * `keep` คือรายการ key ที่ยอมให้อยู่ใน canonical **และลำดับของมัน** (ลำดับต้องคงที่
 * ไม่งั้น `?a=1&b=2` กับ `?b=2&a=1` จะกลายเป็น canonical สองค่าของหน้าเดียวกัน)
 */
export function canonicalPath(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined> | undefined,
  keep: readonly string[],
): string {
  const parts: string[] = [];

  for (const key of keep) {
    const raw = searchParams?.[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === "") continue;
    // หน้าแรกของรายการไม่ต้องมี ?page=1 — ไม่งั้น / กับ /?page=1 เป็นสองหน้า
    if (key === "page" && value === "1") continue;
    parts.push(`${key}=${encodeURIComponent(value)}`);
  }

  return parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
}

/**
 * หน้าที่ต้องไม่ถูกเก็บเข้าดัชนี แต่ยังให้ตามลิงก์ต่อได้
 * (ตะกร้า · checkout · ผลค้นหาภายใน · หน้าเข้าสู่ระบบ)
 */
export const NOINDEX_FOLLOW: Metadata["robots"] = { index: false, follow: true };

/** หน้าส่วนตัวและหลังบ้าน — ไม่เก็บเข้าดัชนีและไม่ต้องตามลิงก์ข้างในด้วย */
export const NOINDEX_NOFOLLOW: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
};

/* ──────────────────────────── JSON-LD ────────────────────────────
 * ส่งผลลัพธ์ของฟังก์ชันพวกนี้เข้า <JsonLd data={...} /> เท่านั้น
 * (ดูเหตุผลเรื่องความปลอดภัยใน components/shared/json-ld.tsx)
 * ------------------------------------------------------------------ */

export type JsonLdObject = Record<string, unknown>;

/** ตัวตนของร้าน — ใส่ไว้ที่ root layout ครั้งเดียว */
export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: SITE_NAME,
    url: SITE_URL,
    slogan: "Find your style, be you",
    description:
      "ร้านค้าออนไลน์แฟชั่นสำหรับวัยรุ่น เสื้อผ้าหลากหลายสไตล์ พร้อมผู้ช่วยแนะนำการแต่งตัวด้วย AI",
    /*
     * ไม่ใส่ `logo`, `sameAs`, `telephone`, `email` โดยเจตนา
     * โลโก้เป็นข้อความ (ยังไม่มีไฟล์ภาพจริง) · ลิงก์โซเชียลในโปรเจกต์ยังเป็น placeholder
     * (instagram.com เฉย ๆ ไม่ใช่โปรไฟล์ของร้าน) · เบอร์/อีเมลต้องมาจาก config ของ backend
     * การประกาศค่าสมมติในนี้คือการบอก Google ว่าร้านนี้มีตัวตนแบบที่ไม่มีจริง → STEP 49
     */
  };
}

/** เว็บไซต์ — **ไม่มี `SearchAction`** เพราะ /search ยังเป็น placeholder (STEP 45) */
export function webSiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "th-TH",
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/** เส้นทางนำทาง — ช่วยให้ Google แสดงลำดับชั้นแทน URL ดิบใต้ชื่อผลการค้นหา */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export type ProductAvailability = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

/** แปลงสถานะสต็อกของเราเป็นคำศัพท์ของ schema.org (ต้องตรงกับที่หน้าเว็บบอกผู้ใช้) */
export function availabilityUrl(status: ProductAvailability): string {
  if (status === "OUT_OF_STOCK") return "https://schema.org/OutOfStock";
  if (status === "LOW_STOCK") return "https://schema.org/LimitedAvailability";
  return "https://schema.org/InStock";
}

export interface ProductJsonLdInput {
  name: string;
  slug: string;
  sku: string;
  description: string;
  images: readonly string[];
  /** ราคาที่ต้องจ่ายจริง (salePrice ?? price) — ต้องตรงกับที่แสดงบนหน้าเว็บและที่เก็บเงินจริง */
  price: number;
  stockStatus: ProductAvailability;
  brandName: string | null;
  categoryName: string;
  /** null = ยังไม่มีรีวิวที่อนุมัติ → **ห้ามใส่ aggregateRating** */
  rating: { average: number; total: number } | null;
}

export function productJsonLd(product: ProductJsonLdInput): JsonLdObject {
  const url = absoluteUrl(`/product/${product.slug}`);

  const data: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    description: product.description,
    url,
    category: product.categoryName,
    image: product.images.map((image) => absoluteUrl(image)),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "THB",
      price: product.price,
      availability: availabilityUrl(product.stockStatus),
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: SITE_NAME },
    },
  };

  if (product.brandName !== null) {
    data.brand = { "@type": "Brand", name: product.brandName };
  }

  // มีรีวิวที่อนุมัติแล้วเท่านั้นจึงประกาศคะแนน (กฎเดียวกับ STEP 23 ข้อ 4: 0 ดาว ≠ ไม่มีข้อมูล)
  if (product.rating !== null && product.rating.total > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: product.rating.average,
      reviewCount: product.rating.total,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return data;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * FAQPage — คำถาม/คำตอบต้องเป็นชุดเดียวกับที่แสดงบนหน้า `/faq`
 * (Google ถือว่า structured data ที่ไม่ตรงกับเนื้อหาบนหน้าเป็นการหลอก และตัดสิทธิ์ rich result)
 */
export function faqPageJsonLd(entries: readonly FaqEntry[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export interface LookJsonLdInput {
  name: string;
  slug: string;
  description: string;
  image: string | null;
  /** ราคารวมของชุด — ใส่ได้เฉพาะเมื่อซื้อครบชุดได้จริง */
  totalPrice: number | null;
  productNames: readonly string[];
}

/**
 * ลุค = ชุดของสินค้าหลายชิ้น จึงใช้ `ItemList` ไม่ใช่ `Product`
 * (ประกาศเป็น Product ทั้งที่ไม่มี SKU เดียวและซื้อเป็นชิ้นเดียวไม่ได้ = ข้อมูลผิด)
 */
export function lookJsonLd(look: LookJsonLdInput): JsonLdObject {
  const data: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: look.name,
    description: look.description,
    url: absoluteUrl(`/looks/${look.slug}`),
    numberOfItems: look.productNames.length,
    itemListElement: look.productNames.map((name, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
    })),
  };

  if (look.image !== null) data.image = absoluteUrl(look.image);

  return data;
}
