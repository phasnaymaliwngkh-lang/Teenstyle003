import { describe, expect, it } from "vitest";

import {
  absoluteUrl,
  availabilityUrl,
  breadcrumbJsonLd,
  canonicalPath,
  faqPageJsonLd,
  lookJsonLd,
  organizationJsonLd,
  productJsonLd,
  webSiteJsonLd,
} from "./seo";

/**
 * เทสต์ของตัวช่วย SEO (STEP 33)
 *
 * ของพวกนี้พังแบบเงียบที่สุดในโปรเจกต์: หน้าเว็บยังแสดงผลปกติทุกอย่าง
 * แต่ Google อ่านได้เป็นคนละเรื่อง — ไม่มี error ไม่มีหน้าขาว ไม่มีใครรู้จนกว่าจะเสียอันดับ
 */

describe("canonicalPath — กันหน้าเดียวแตกเป็นหลาย URL", () => {
  it("ตัด query ที่ไม่ได้อยู่ในรายการทิ้ง", () => {
    const result = canonicalPath(
      "/shop",
      { category: "tops", sort: "price-asc", color: "black,white", q: "เสื้อ" },
      ["category", "page"],
    );

    expect(result).toBe("/shop?category=tops");
  });

  it("ไม่ใส่ ?page=1 เพราะเป็นหน้าเดียวกับที่ไม่มี page", () => {
    expect(canonicalPath("/shop", { page: "1" }, ["category", "page"])).toBe("/shop");
    expect(canonicalPath("/shop", { page: "3" }, ["category", "page"])).toBe("/shop?page=3");
  });

  it("ลำดับ query คงที่เสมอ ไม่ขึ้นกับลำดับที่ผู้ใช้พิมพ์มา", () => {
    const a = canonicalPath("/shop", { page: "2", category: "tops" }, ["category", "page"]);
    const b = canonicalPath("/shop", { category: "tops", page: "2" }, ["category", "page"]);

    expect(a).toBe(b);
    expect(a).toBe("/shop?category=tops&page=2");
  });

  it("encode ค่าที่มีอักขระพิเศษ", () => {
    expect(canonicalPath("/shop", { category: "เสื้อ ยืด" }, ["category"])).toBe(
      "/shop?category=%E0%B9%80%E0%B8%AA%E0%B8%B7%E0%B9%89%E0%B8%AD%20%E0%B8%A2%E0%B8%B7%E0%B8%94",
    );
  });

  it("ไม่มี query ที่เข้าเกณฑ์ = คืน path เปล่า", () => {
    expect(canonicalPath("/looks", { q: "สตรีท" }, ["style", "page"])).toBe("/looks");
    expect(canonicalPath("/looks", undefined, ["style"])).toBe("/looks");
  });
});

describe("absoluteUrl", () => {
  it("เติมโดเมนให้ path และไม่แตะ URL ที่เต็มอยู่แล้ว", () => {
    expect(absoluteUrl("/shop")).toMatch(/^https?:\/\/[^/]+\/shop$/);
    expect(absoluteUrl("https://images.example.com/a.jpg")).toBe(
      "https://images.example.com/a.jpg",
    );
  });
});

describe("productJsonLd — ห้ามประกาศสิ่งที่ไม่มีจริง", () => {
  const base = {
    name: "เสื้อยืดโอเวอร์ไซซ์",
    slug: "oversize-tee",
    sku: "TS-TEE-001",
    description: "ผ้าคอตตอน 100%",
    images: ["https://images.example.com/tee.jpg"],
    price: 590,
    stockStatus: "IN_STOCK" as const,
    brandName: "TeenStyle",
    categoryName: "เสื้อยืด",
    rating: null,
  };

  it("ยังไม่มีรีวิว → ไม่มี aggregateRating (ไม่ใช่ 0 ดาว)", () => {
    expect(productJsonLd(base).aggregateRating).toBeUndefined();
    expect(
      productJsonLd({ ...base, rating: { average: 0, total: 0 } }).aggregateRating,
    ).toBeUndefined();
  });

  it("มีรีวิวแล้ว → ประกาศคะแนนตามจริง", () => {
    const data = productJsonLd({ ...base, rating: { average: 4.5, total: 12 } });

    expect(data.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("ราคาที่ประกาศคือราคาที่เก็บเงินจริง และสกุลเป็น THB", () => {
    const offers = productJsonLd(base).offers as Record<string, unknown>;

    expect(offers.price).toBe(590);
    expect(offers.priceCurrency).toBe("THB");
  });

  it("ไม่มีแบรนด์ → ไม่ใส่ฟิลด์ brand", () => {
    expect(productJsonLd({ ...base, brandName: null }).brand).toBeUndefined();
    expect(productJsonLd(base).brand).toEqual({ "@type": "Brand", name: "TeenStyle" });
  });

  it("รูปทุกใบเป็น URL เต็ม (schema.org ไม่รับ path สัมพัทธ์)", () => {
    const data = productJsonLd({ ...base, images: ["/uploads/a.jpg", "https://x.test/b.jpg"] });

    expect(data.image).toEqual([absoluteUrl("/uploads/a.jpg"), "https://x.test/b.jpg"]);
  });

  it("สถานะสต็อกแปลงตรงกับที่หน้าเว็บบอกผู้ใช้", () => {
    expect(availabilityUrl("IN_STOCK")).toBe("https://schema.org/InStock");
    expect(availabilityUrl("LOW_STOCK")).toBe("https://schema.org/LimitedAvailability");
    expect(availabilityUrl("OUT_OF_STOCK")).toBe("https://schema.org/OutOfStock");
  });
});

describe("ตัวตนของร้าน — ห้ามประกาศช่องทางที่ยังไม่มีจริง", () => {
  it("Organization ไม่มี sameAs / logo / เบอร์โทร (ยังไม่มีของจริง — STEP 49)", () => {
    const data = organizationJsonLd();

    expect(data.sameAs).toBeUndefined();
    expect(data.logo).toBeUndefined();
    expect(data.telephone).toBeUndefined();
    expect(data.email).toBeUndefined();
    expect(data["@type"]).toBe("OnlineStore");
  });

  it("WebSite ไม่ประกาศ SearchAction เพราะ /search ยังเป็น placeholder (STEP 45)", () => {
    const data = webSiteJsonLd();

    expect(data.potentialAction).toBeUndefined();
    expect(data.inLanguage).toBe("th-TH");
  });
});

describe("breadcrumb / faq / look", () => {
  it("breadcrumb เรียงตำแหน่งจาก 1 และใช้ URL เต็ม", () => {
    const data = breadcrumbJsonLd([
      { name: "หน้าแรก", path: "/" },
      { name: "เลือกซื้อสินค้า", path: "/shop" },
    ]);
    const items = data.itemListElement as Array<Record<string, unknown>>;

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ position: 1, name: "หน้าแรก", item: absoluteUrl("/") });
    expect(items[1]).toMatchObject({ position: 2, item: absoluteUrl("/shop") });
  });

  it("FAQPage แปลงคำถาม/คำตอบตรงตัว", () => {
    const data = faqPageJsonLd([{ question: "ส่งกี่วัน?", answer: "2–3 วันทำการ" }]);
    const entries = data.mainEntity as Array<Record<string, unknown>>;

    expect(entries[0]).toEqual({
      "@type": "Question",
      name: "ส่งกี่วัน?",
      acceptedAnswer: { "@type": "Answer", text: "2–3 วันทำการ" },
    });
  });

  it("ลุคเป็น ItemList ไม่ใช่ Product (ซื้อเป็นชิ้นเดียวไม่ได้)", () => {
    const data = lookJsonLd({
      name: "Street Casual",
      slug: "street-casual",
      description: "ลุคสตรีท",
      image: null,
      totalPrice: 1990,
      productNames: ["เสื้อยืด", "กางเกงคาร์โก้"],
    });

    expect(data["@type"]).toBe("ItemList");
    expect(data.numberOfItems).toBe(2);
    expect(data.image).toBeUndefined();
  });
});
