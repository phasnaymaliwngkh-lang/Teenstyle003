import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..", "src");

/**
 * สัญญาของหน้าต่าง (modal/dialog) — บังคับด้วยเครื่อง (STEP 37)
 *
 * CLAUDE.md หัวข้อ "Accessibility — จุดที่พลาดบ่อย" เขียนกฎไว้ 5 ข้อ
 * แต่เดิมเป็น **วินัยของคนเขียน** เท่านั้น: หน้าต่างที่ขาด Esc หรือขาด scroll lock
 * ยังเปิดได้ปิดได้ด้วยเมาส์ หน้าเว็บดูปกติทุกอย่าง **ไม่มีอะไรฟ้องเลย**
 * คนที่ใช้คีย์บอร์ดหรือ screen reader คือคนเดียวที่เจอปัญหา และเขาไม่ใช่คนเขียนโค้ด
 *
 * เทสต์นี้อ่านซอร์สแล้วยืนยันว่าทุกไฟล์ที่มีหน้าต่างทำครบ — คู่กับ
 * `src/components/layout/mobile-menu.test.tsx` ที่ยืนยันว่า **แพตเทิร์นอ้างอิงทำงานจริง**
 * (อ่านซอร์สบอกได้แค่ว่า "เขียนไว้" · เรนเดอร์จริงบอกได้ว่า "ทำงาน" — ต้องมีทั้งคู่)
 */

function collectTsxFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...collectTsxFiles(full));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }

  return out;
}

interface DialogFile {
  relative: string;
  source: string;
}

const dialogFiles: DialogFile[] = collectTsxFiles(SRC)
  .map((file) => ({
    relative: path.relative(SRC, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }))
  .filter(({ source }) => source.includes('role="dialog"'));

describe('สัญญาของหน้าต่าง — ทุกไฟล์ที่มี role="dialog" (STEP 37)', () => {
  it("มีไฟล์ที่ต้องตรวจอยู่จริง — ไม่ใช่เทสต์ที่ผ่านเพราะไม่เจออะไรเลย", () => {
    expect(dialogFiles.length).toBeGreaterThanOrEqual(3);
  });

  it.each(dialogFiles.map((file) => [file.relative, file] as const))(
    "%s ประกาศ aria-modal และมีชื่อให้ screen reader",
    (_relative, file) => {
      expect(file.source).toContain('aria-modal="true"');
      expect(/aria-labelledby=|aria-label=/.test(file.source)).toBe(true);
    },
  );

  it.each(dialogFiles.map((file) => [file.relative, file] as const))(
    "%s ปิดด้วย Esc ได้ และถอด listener ตอน unmount",
    (_relative, file) => {
      expect(file.source).toContain('"Escape"');
      expect(file.source).toContain('addEventListener("keydown"');
      expect(file.source).toContain('removeEventListener("keydown"');
    },
  );

  it.each(dialogFiles.map((file) => [file.relative, file] as const))(
    "%s ล็อก scroll ของหน้าเบื้องหลัง และคืนค่าเดิมตอนปิด",
    (_relative, file) => {
      expect(file.source).toContain('document.body.style.overflow = "hidden"');
      // คืน "ค่าเดิม" ไม่ใช่ตั้งเป็นค่าว่าง — หน้าที่ล็อก scroll อยู่ก่อนแล้วจะถูกปลดผิด
      expect(file.source).toMatch(/document\.body\.style\.overflow = previousOverflow/);
    },
  );

  /**
   * พื้นหลังต้องเป็น element ของตัวเองที่ aria-hidden — ไม่ใช่ `bg-ink/50` บนกล่องเดียวกับเนื้อหา
   * ถ้าเป็นกล่องเดียวกัน การคลิกปิดจะกินคลิกของเนื้อหาด้วย และ screen reader
   * จะอ่านพื้นหลังเป็นส่วนหนึ่งของหน้าต่าง
   */
  it.each(dialogFiles.map((file) => [file.relative, file] as const))(
    "%s พื้นหลังเป็น element แยกที่ aria-hidden",
    (_relative, file) => {
      expect(file.source).toMatch(/aria-hidden[\s\S]{0,400}role="dialog"/);
    },
  );
});
