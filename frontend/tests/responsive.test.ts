import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * กฎ responsive ที่ต้องไม่ถอยหลัง (STEP 31)
 *
 * การตรวจจริงว่า "หน้าไม่ล้นและปุ่มกดได้" ทำด้วย Chrome จริงผ่าน
 * `node scripts/audit-responsive.mjs` (วัด scrollWidth และขนาดกล่องของจริง)
 * ซึ่งต้องมีเซิร์ฟเวอร์และฐานข้อมูลรันอยู่ จึงอยู่ใน `npm test` ไม่ได้
 *
 * ไฟล์นี้จึงล็อก **เงื่อนไขที่ทำให้การตรวจนั้นยังมีความหมาย** แทน:
 *   1. ไม่มีใครเอา overflow-x: hidden กลับมาปิดอาการที่ระดับ body/html
 *   2. ทุกหน้าที่มีอยู่จริงต้องอยู่ในรายการที่สคริปต์ไล่ตรวจ (หน้าใหม่ห้ามหลุด)
 *   3. เกณฑ์พื้นที่กดยังเป็น 44px
 *   4. ไม่มีปุ่ม/ลิงก์/ช่องกรอกที่ตั้งขนาดไว้ต่ำกว่า 44px แบบคงที่ในซอร์ส
 */

const frontendRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const appDir = path.join(frontendRoot, "src", "app");
const auditScript = readFileSync(path.join(repoRoot, "scripts", "audit-responsive.mjs"), "utf8");

/* ───────────────────────── ตัวช่วยเดินไฟล์ ───────────────────────── */

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

/** `(storefront)/product/[slug]/page.tsx` → `/product/*` (รูปร่างของเส้นทาง ไม่สนชื่อพารามิเตอร์) */
function routeShapeOfPage(file: string): string {
  const relative = path.relative(appDir, file).replaceAll("\\", "/");
  const segments = relative
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.startsWith("(")) // route group ไม่มีผลกับ URL
    .map((segment) => (segment.startsWith("[") ? "*" : segment));

  return `/${segments.join("/")}`;
}

/** `/product/{productSlug}` หรือ `/shop?x=1` → `/product/*` · `/shop` */
function routeShapeOfAudited(routePath: string): string {
  const withoutQuery = routePath.split("?")[0] ?? "";
  const segments = withoutQuery
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => (segment.startsWith("{") ? "*" : segment));

  return `/${segments.join("/")}`;
}

// รับทั้ง ' และ " เพราะ prettier ของโปรเจกต์นี้ใช้ single quote กับไฟล์ .mjs
// (เทสต์ที่ผูกกับรูปแบบการจัดฟอร์แมตจะพังเองตอนมีคนรัน prettier — เคยเกิดจริงตอนเขียนไฟล์นี้)
const auditedShapes = new Set(
  [...auditScript.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map((match) =>
    routeShapeOfAudited(match[1] ?? ""),
  ),
);

/**
 * หน้าที่ **ไม่ต้อง** อยู่ในรายการตรวจ — ต้องตรงเป๊ะ ไม่ใช่ "อย่างน้อย"
 * เพิ่มชื่อเข้ารายการนี้ได้ แต่ต้องเห็นใน diff (แพตเทิร์นเดียวกับ api-contract.test.ts ของ STEP 29)
 */
const NOT_AUDITED = new Set([
  "/after-signin", // ไม่มี UI — redirect ทันทีตามบทบาท
]);

/* ───────────────────────────── เทสต์ ───────────────────────────── */

describe("responsive — กันการถอยหลังของ STEP 31", () => {
  it("globals.css ต้องไม่ซ่อนการล้นด้วย overflow-x: hidden ที่ body/html", () => {
    // ตัดคอมเมนต์ออกก่อน — ไม่งั้นคำอธิบายที่บอกว่า "เคยมี overflow-x: hidden" จะถูกนับเป็นของจริง
    const css = readFileSync(path.join(appDir, "globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    // มองหาบล็อกของ body/html ที่ประกาศ overflow-x/overflow เป็น hidden หรือ clip
    const blocks = [...css.matchAll(/(^|\})\s*(html|body)[^{}]*\{([^}]*)\}/gm)];
    const masking = blocks.filter(({ 3: body }) =>
      /overflow(-x)?\s*:\s*(hidden|clip)/.test(body ?? ""),
    );

    expect(
      masking.map((match) => match[2]),
      "overflow-x: hidden ที่ body/html ไม่ได้ป้องกันการล้น มันแค่ตัดของที่ล้นให้มองไม่เห็น " +
        "(และหน้ายังเลื่อนได้จริงเพราะ viewport propagation มาจาก html) — " +
        "ให้แก้ที่ต้นเหตุตามที่ scripts/audit-responsive.mjs ชี้ให้",
    ).toEqual([]);
  });

  it("ทุกหน้าใน app/ ต้องอยู่ในรายการที่สคริปต์ตรวจ", () => {
    const pages = walk(appDir).filter((file) => file.endsWith(`${path.sep}page.tsx`));
    expect(pages.length).toBeGreaterThan(40);

    const missing = pages
      .map(routeShapeOfPage)
      .filter((shape) => !auditedShapes.has(shape) && !NOT_AUDITED.has(shape))
      .sort();

    expect(
      missing,
      "หน้าใหม่ต้องถูกเพิ่มใน ROUTES ของ scripts/audit-responsive.mjs ไม่งั้นไม่มีใครตรวจว่ามันล้นที่ 360px หรือไม่",
    ).toEqual([]);
  });

  it("รายการยกเว้นต้องไม่มีชื่อที่เลิกใช้แล้ว", () => {
    const shapes = new Set(
      walk(appDir)
        .filter((file) => file.endsWith(`${path.sep}page.tsx`))
        .map(routeShapeOfPage),
    );

    const stale = [...NOT_AUDITED].filter((shape) => !shapes.has(shape));
    expect(stale, "ชื่อที่ไม่มีหน้าจริงแล้วต้องถูกลบออกจาก NOT_AUDITED").toEqual([]);
  });

  it("เกณฑ์พื้นที่กดของสคริปต์ตรวจยังเป็น 44px", () => {
    expect(auditScript).toMatch(/const MIN_TOUCH = 44;/);
  });

  /**
   * ปุ่ม/ลิงก์/ช่องกรอกที่ตั้งความสูงคงที่ต่ำกว่า 44px จะกดยากบนมือถือ
   * ตรวจจาก **ชนิดของแท็กที่ล้อมคลาสนั้นอยู่** (ไล่ย้อนหาเครื่องหมาย `<` ที่ใกล้ที่สุด)
   * ไม่ใช่เดาจากบริบท — ไอคอน `size-5` ใน <svg> หรือ avatar `size-10` ใน <div> ไม่เกี่ยว
   */
  it("ไม่มีตัวควบคุมที่ตั้งขนาดคงที่ต่ำกว่า 44px", () => {
    const controlTags = new Set(["button", "a", "Link", "summary", "select", "textarea", "label"]);
    /** คลาสที่ให้ความสูง/ความกว้างต่ำกว่า 44px (0.25rem ต่อหนึ่งหน่วย) */
    const tooSmall = /\b(?:size|h|min-h)-(?:[1-9]|10)\b/;
    /** ถ้าในคลาสเดียวกันมีค่าที่ผ่านเกณฑ์อยู่แล้ว ถือว่าตั้งใจใช้คู่กับ breakpoint */
    const hasBigEnough = /\b(?:size|h|min-h)-(?:1[1-9]|[2-9]\d|full|screen)\b/;

    const offenders: string[] = [];

    for (const file of walk(path.join(frontendRoot, "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");

      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
        const classes = match[1] ?? match[2] ?? "";
        if (!tooSmall.test(classes) || hasBigEnough.test(classes)) continue;

        // ไล่ย้อนจากตำแหน่งที่เจอไปหาชื่อแท็กที่เปิดอยู่
        const opening = source.lastIndexOf("<", match.index);
        if (opening < 0) continue;
        const tag = /^<\s*([A-Za-z][\w.]*)/.exec(source.slice(opening, opening + 40))?.[1];
        if (tag === undefined || !controlTags.has(tag)) continue;

        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(frontendRoot, file)}:${line} <${tag}> ${classes.slice(0, 70)}`,
        );
      }
    }

    expect(
      offenders,
      "ตัวควบคุมต้องมีพื้นที่กด ≥ 44px (min-h-11 / size-11) — กฎข้อ 11 ของ CLAUDE.md",
    ).toEqual([]);
  });
});
