import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JsonLd } from "../src/components/shared/json-ld";

/**
 * กฎ SEO ที่ต้องไม่ถอยหลัง (STEP 33)
 *
 * การตรวจจริงว่า title/canonical/sitemap ถูกต้องทำด้วย `node scripts/audit-seo.mjs`
 * (ต้องมีเซิร์ฟเวอร์รันอยู่) ไฟล์นี้ล็อกสิ่งที่ตรวจได้จากซอร์สโดยตรง
 */

const frontendRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(frontendRoot, "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function read(relative: string): string {
  return readFileSync(path.join(appDir, relative), "utf8");
}

describe("JSON-LD — ความปลอดภัยของการฝัง structured data", () => {
  /**
   * คอมโพเนนต์ `JsonLd` ตั้งอยู่บนสมมติฐานว่า React จัดการ `<script>` ให้ปลอดภัยเอง
   * จึงไม่ต้องใช้ `dangerouslySetInnerHTML` (ซึ่งโปรเจกต์นี้ห้ามใช้ — STEP 28)
   * ถ้าสมมติฐานนี้เปลี่ยน (อัป React แล้วพฤติกรรมต่างไป) ต้องรู้ทันทีจากเทสต์ ไม่ใช่จากช่องโหว่
   */
  it("ข้อมูลที่พยายามปิดแท็ก script ถูกทำให้ปิดไม่ได้ และยังเป็น JSON ที่อ่านได้", () => {
    const hostile = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: '</script><img src=x onerror="alert(1)">',
      description: 'เครื่องหมาย " & < > ต้องอยู่ครบ',
    };

    const html = renderToStaticMarkup(createElement(JsonLd, { data: hostile }));

    // ปิด element ก่อนเวลาไม่ได้ → แทรกแท็กใหม่ไม่ได้
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u0073cript");

    // และเนื้อหายังเป็น JSON ที่ถูกต้อง (ไม่ถูก escape เป็น HTML entity)
    const inner = html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    const parsed = JSON.parse(inner) as Record<string, string>;
    expect(parsed.name).toBe(hostile.name);
    expect(parsed.description).toBe(hostile.description);
  });

  it("ส่งหลายก้อนได้และแต่ละก้อนเป็น script ของตัวเอง", () => {
    const html = renderToStaticMarkup(
      createElement(JsonLd, {
        data: [
          { "@context": "https://schema.org", "@type": "WebSite" },
          { "@context": "https://schema.org", "@type": "Organization" },
        ],
      }),
    );

    expect([...html.matchAll(/<script/g)]).toHaveLength(2);
  });

  it("ไม่มีที่ไหนในโปรเจกต์ใช้ dangerouslySetInnerHTML จริง ๆ", () => {
    /*
     * ต้องตัดคอมเมนต์ออกก่อน — มีหลายไฟล์ที่ **อธิบายว่าทำไมถึงไม่ใช้** (บาร์โค้ด SVG, JSON-LD)
     * ถ้านับข้อความในคอมเมนต์เป็นการใช้งาน เทสต์จะฟ้องไฟล์ที่ทำถูกต้องอยู่แล้ว
     */
    const stripComments = (source: string): string =>
      source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");

    const offenders = walk(path.join(frontendRoot, "src"))
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .filter((file) =>
        stripComments(readFileSync(file, "utf8")).includes("dangerouslySetInnerHTML"),
      )
      .map((file) => path.relative(frontendRoot, file));

    expect(offenders, "กฎ STEP 28 — JSON-LD ใช้ children ของ <script> แทน").toEqual([]);
  });
});

describe("noindex — หน้าที่ต้องไม่ขึ้นดัชนี", () => {
  it("layout ของ /admin ประกาศ noindex ให้ทุกหน้าใต้มัน", () => {
    const layout = read("admin/layout.tsx");

    expect(layout).toContain("export const metadata");
    expect(layout).toContain("NOINDEX_NOFOLLOW");
  });

  it("ทุกหน้าในบัญชีผู้ใช้ประกาศ robots ของตัวเอง", () => {
    const accountPages = walk(path.join(appDir, "(storefront)", "account")).filter((file) =>
      file.endsWith("page.tsx"),
    );

    const missing = accountPages
      .filter((file) => !readFileSync(file, "utf8").includes("robots"))
      .map((file) => path.relative(appDir, file));

    expect(missing).toEqual([]);
  });

  it("หน้าที่ไม่ควรขึ้นดัชนีมี robots ครบทุกหน้า", () => {
    const mustHaveRobots = [
      "(storefront)/cart/page.tsx",
      "(storefront)/checkout/page.tsx",
      "(storefront)/checkout/success/page.tsx",
      "(storefront)/search/page.tsx",
      "(storefront)/wishlist/page.tsx",
      "(storefront)/forbidden/page.tsx",
      "(storefront)/unauthorized/page.tsx",
      "signin/page.tsx",
    ];

    const missing = mustHaveRobots.filter((file) => !read(file).includes("robots"));
    expect(missing).toEqual([]);
  });
});

describe("sitemap กับ robots ต้องไม่ขัดกันเอง", () => {
  const sitemapSource = readFileSync(path.join(appDir, "sitemap.ts"), "utf8");
  const robotsSource = readFileSync(path.join(appDir, "robots.ts"), "utf8");

  /** รายการ Disallow ต้องเปลี่ยนแบบเห็นใน diff ไม่ใช่เปลี่ยนแล้วไม่มีใครรู้ */
  it("รายการ Disallow ตรงกับที่ตั้งใจไว้เป๊ะ", () => {
    const disallow = [...robotsSource.matchAll(/^\s*"(\/[^"]*)",\s*\/\//gm)].map((m) => m[1]);
    const allDisallow = [...robotsSource.matchAll(/^\s{10}"(\/[^"]*)",/gm)].map((m) => m[1]);

    expect(allDisallow.length).toBeGreaterThanOrEqual(disallow.length);
    expect(allDisallow).toEqual([
      "/admin",
      "/account",
      "/api/",
      "/cart",
      "/checkout",
      "/wishlist",
      "/signin",
      "/after-signin",
      "/forbidden",
      "/unauthorized",
    ]);
  });

  it("หน้าคงที่ใน sitemap ต้องไม่ใช่หน้าที่ถูก Disallow", () => {
    const onlyStrings = (values: (string | undefined)[]): string[] =>
      values.filter((value): value is string => value !== undefined);

    const staticPaths = onlyStrings(
      [...sitemapSource.matchAll(/^\s{2}"(\/[^"]*)",/gm)].map((match) => match[1]),
    );
    const disallow = onlyStrings(
      [...robotsSource.matchAll(/^\s{10}"(\/[^"]*)",/gm)].map((match) => match[1]),
    );

    expect(staticPaths.length).toBeGreaterThan(3);

    const conflicting = staticPaths.filter((entry) =>
      disallow.some((rule) => entry.startsWith(rule)),
    );
    expect(conflicting, "URL ที่เราสั่งห้ามคลานต้องไม่อยู่ใน sitemap").toEqual([]);
  });

  it("sitemap ไม่ใส่ lastModified ปลอม", () => {
    expect(sitemapSource).not.toMatch(/lastModified:\s*new Date\(\)/);
  });
});
