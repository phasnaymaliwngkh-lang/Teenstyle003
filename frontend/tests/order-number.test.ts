import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ตัวอย่างเลขคำสั่งซื้อที่ frontend เขียนไว้ ต้องตรงกับรูปแบบจริงของ backend (STEP 40)
 *
 * frontend import โค้ดของ backend ไม่ได้ (คนละ workspace และเป็นโค้ดฝั่งเซิร์ฟเวอร์)
 * จึงเทียบกับ **ไฟล์ต้นทาง** แทน — แพตเทิร์นเดียวกับที่ `responsive.test.ts`
 * และ `dialog.test.ts` ใช้ตรวจกฎระดับโปรเจกต์
 *
 * บั๊กที่ล็อกไว้: placeholder ของช่องแชตเคยบอกลูกค้าว่า "เช็คพัสดุ ORD-..."
 * ซึ่งเป็นรูปแบบที่ไม่มีอยู่ในระบบเลย (ของจริงคือ `TS-YYYYMMDD-####`)
 * → พาลูกค้าไปหาเลขที่ไม่มี แล้ว AI ก็จับเลขที่เขาพิมพ์ไม่ได้ด้วย
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const orderModel = readFileSync(
  path.join(repoRoot, "backend", "src", "models", "order.model.ts"),
  "utf8",
);

/** ดึง prefix จริงออกมาจากไฟล์ต้นทาง ไม่ได้พิมพ์ซ้ำในเทสต์ */
const prefix = /ORDER_NUMBER_PREFIX = '([A-Z]+)'/.exec(orderModel)?.[1];

const FRONTEND_FILES_MENTIONING_ORDER_NUMBER = [
  path.join("src", "features", "customer-service", "components", "cs-chat.tsx"),
];

describe("ตัวอย่างเลขคำสั่งซื้อใน frontend (STEP 40)", () => {
  it("อ่าน prefix จริงจาก backend ได้ (ถ้าอ่านไม่ได้ เทสต์ที่เหลือจะไม่มีความหมาย)", () => {
    expect(prefix).toBe("TS");
  });

  it.each(FRONTEND_FILES_MENTIONING_ORDER_NUMBER)(
    "%s ไม่มีรูปแบบเลขคำสั่งซื้อที่ไม่ใช่ของจริง",
    (relative) => {
      const source = readFileSync(path.join(repoRoot, "frontend", relative), "utf8");
      const candidates = source.match(/\b[A-Z]{2,4}-(?:\d|[A-Z#]){4,}/g) ?? [];

      for (const candidate of candidates) {
        expect(candidate.startsWith(`${prefix}-`)).toBe(true);
      }
    },
  );

  it("ตัวอย่างที่โชว์ในช่องแชตต้องอยู่ในรูปแบบที่ backend อ่านได้", () => {
    const source = readFileSync(
      path.join(repoRoot, "frontend", FRONTEND_FILES_MENTIONING_ORDER_NUMBER[0]!),
      "utf8",
    );
    const examples = source.match(/\bTS-\d{8}-\d{4}\b/g) ?? [];

    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example).toMatch(new RegExp(`^${prefix}-\\d{8}-\\d{4}$`));
    }
  });
});
