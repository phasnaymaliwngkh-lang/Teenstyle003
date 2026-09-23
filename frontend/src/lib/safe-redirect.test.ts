import { describe, expect, it } from "vitest";

import { safeInternalPath } from "./safe-redirect";

/**
 * เทสต์ของด่านกัน open redirect (STEP 28)
 *
 * ของนี้เป็นตรรกะความปลอดภัยที่ **พังแล้วไม่มีอะไรฟ้อง** — หน้าเว็บยังทำงานปกติทุกอย่าง
 * แต่กลายเป็นช่องฟิชชิงที่เนียนที่สุด เพราะเหยื่อเริ่มจากเว็บจริงและล็อกอินกับเว็บจริง
 * จึงต้องมีเทสต์ล็อกทุกรูปแบบที่เคยเจอและที่คิดได้
 */

/** ตรวจซ้ำแบบเบราว์เซอร์: resolve ผลลัพธ์แล้วต้องยังอยู่โดเมนเดิม */
const OUR_ORIGIN = "https://teenstyle.example";

function staysInside(path: string): boolean {
  return new URL(path, OUR_ORIGIN).origin === OUR_ORIGIN;
}

describe("safeInternalPath — path ภายในที่ถูกต้อง", () => {
  it("ปล่อยผ่าน path ธรรมดา", () => {
    expect(safeInternalPath("/account")).toBe("/account");
    expect(safeInternalPath("/admin/orders")).toBe("/admin/orders");
    expect(safeInternalPath("/")).toBe("/");
  });

  it("เก็บ query string และ hash ไว้ครบ", () => {
    expect(safeInternalPath("/shop?page=2&sort=newest")).toBe("/shop?page=2&sort=newest");
    expect(safeInternalPath("/product/tee#reviews")).toBe("/product/tee#reviews");
  });
});

describe("safeInternalPath — ต้องปฏิเสธทุกรูปแบบที่ออกนอกเว็บ", () => {
  it("⚠️ แบ็กสแลช — ช่องโหว่จริงที่ด่านเดิมเจาะได้", () => {
    // WHATWG URL ถือว่า "\" เท่ากับ "/" → "/\evil.com" กลายเป็น "//evil.com"
    // ด่านเดิมที่เช็คแค่ startsWith("/") และ !startsWith("//") ปล่อยค่านี้ผ่าน
    expect(new URL("/\\evil.com", OUR_ORIGIN).origin).toBe("https://evil.com");

    expect(safeInternalPath("/\\evil.com")).toBe("/");
    expect(safeInternalPath("/\\\\evil.com")).toBe("/");
    expect(safeInternalPath("/path/\\evil.com")).toBe("/");
  });

  it("⚠️ path ที่ normalize แล้วกลายเป็น protocol-relative เอง", () => {
    // ".." ทำให้ pathname ที่ normalize ออกมาเป็น "//evil.com"
    // ทั้งที่ input ผ่านทุกด่านต้นทาง (ขึ้นต้นด้วย / · ไม่มีแบ็กสแลช · origin ไม่เปลี่ยน)
    expect(safeInternalPath("/..//evil.com")).toBe("/");
    expect(safeInternalPath("/a/../..//evil.com")).toBe("/");
  });

  it("protocol-relative URL", () => {
    expect(safeInternalPath("//evil.com")).toBe("/");
    expect(safeInternalPath("//evil.com/path")).toBe("/");
  });

  it("URL เต็มทุก scheme", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/");
    expect(safeInternalPath("http://evil.com")).toBe("/");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/");
    expect(safeInternalPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("ค่าที่ไม่ใช่สตริงหรือว่างเปล่า", () => {
    expect(safeInternalPath(null)).toBe("/");
    expect(safeInternalPath(undefined)).toBe("/");
    expect(safeInternalPath("")).toBe("/");
    expect(safeInternalPath(123)).toBe("/");
    expect(safeInternalPath({})).toBe("/");
  });

  it("ใช้ fallback ที่ผู้เรียกกำหนดได้", () => {
    expect(safeInternalPath("https://evil.com", "/after-signin")).toBe("/after-signin");
    expect(safeInternalPath(null, "/after-signin")).toBe("/after-signin");
  });
});

describe("ผลลัพธ์ที่คืนออกมาต้องอยู่ในโดเมนเราเสมอ", () => {
  it("ทุก input ที่คิดได้ resolve แล้วไม่หลุดออกนอกเว็บ", () => {
    const payloads = [
      "/account",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "\\/evil.com",
      "https://evil.com",
      "//evil.com/\\",
      "/%5Cevil.com",
      "/..//evil.com",
      "/\t/evil.com",
      "/\n//evil.com",
      "  //evil.com",
      "/@evil.com",
      "///evil.com",
      "javascript:alert(1)",
      "",
      null,
    ];

    for (const payload of payloads) {
      const result = safeInternalPath(payload);

      expect(result.startsWith("/"), `${JSON.stringify(payload)} → ${result}`).toBe(true);
      expect(staysInside(result), `${JSON.stringify(payload)} → ${result}`).toBe(true);
    }
  });
});
