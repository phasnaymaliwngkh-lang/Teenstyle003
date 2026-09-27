import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileMenu } from "./mobile-menu.tsx";

import { setPathname } from "../../../tests/helpers/next-mocks.ts";

/** server action — import ของจริงจะลาก next-auth + prisma adapter เข้ามาทั้งก้อน */
vi.mock("@/features/auth/actions", () => ({
  signOutAction: vi.fn(),
}));

const CUSTOMER = { name: "สมชาย ใจดี", email: "somchai@example.com", role: "CUSTOMER" };
const ADMIN = { name: "ผู้ดูแล", email: "admin@example.com", role: "ADMIN" };

const openButton = () => screen.getByRole("button", { name: "เปิดเมนู" });
const dialog = () => screen.queryByRole("dialog");

/**
 * เมนูนี้เป็น **แพตเทิร์นอ้างอิงของหน้าต่างทั้งโปรเจกต์** (CLAUDE.md หัวข้อ Accessibility)
 * ทุกข้อที่เทสต์ในไฟล์นี้คือกฎ 5 ข้อที่หน้าต่างอื่นต้องทำตาม — ถอนออกแล้ว
 * หน้าเว็บยังดูปกติและยังกดได้ด้วยเมาส์ จึงไม่มีอะไรฟ้องนอกจากเทสต์ชุดนี้
 */
describe("MobileMenu — สัญญาของหน้าต่าง (STEP 37)", () => {
  it("ยังไม่กดปุ่ม ต้องไม่มีหน้าต่างอยู่ใน DOM", () => {
    render(<MobileMenu user={null} />);

    expect(dialog()).toBeNull();
    expect(openButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("เปิดแล้วต้องเป็น dialog ที่ screen reader รู้ว่าเป็นหน้าต่าง และมีชื่อ", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={null} />);

    await user.click(openButton());

    const panel = screen.getByRole("dialog");

    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.getAttribute("aria-label")).toBeTruthy();
    expect(openButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("กด Esc ต้องปิด — คีย์บอร์ดต้องออกได้ ไม่ใช่ติดอยู่ในหน้าต่าง", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={null} />);

    await user.click(openButton());
    await user.keyboard("{Escape}");

    expect(dialog()).toBeNull();
  });

  it("คลิกพื้นหลังต้องปิด และพื้นหลังต้องเป็น aria-hidden ไม่ใช่กล่องเดียวกับเนื้อหา", async () => {
    const user = userEvent.setup();
    const { container } = render(<MobileMenu user={null} />);

    await user.click(openButton());

    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');

    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(dialog()).toBeNull();
  });

  it("เปิดแล้วต้องล็อก scroll ของหน้าเบื้องหลัง และคืนค่าเดิมตอนปิด", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={null} />);

    expect(document.body.style.overflow).toBe("");

    await user.click(openButton());
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("ถอดคอมโพเนนต์ทิ้งตอนเปิดอยู่ ต้องไม่ทิ้ง scroll lock ค้างไว้ทั้งเว็บ", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MobileMenu user={null} />);

    await user.click(openButton());
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("เปลี่ยนหน้าแล้วต้องปิดเอง — ไม่ค้างทับหน้าใหม่", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileMenu user={null} />);

    await user.click(openButton());
    expect(dialog()).not.toBeNull();

    setPathname("/shop");
    rerender(<MobileMenu user={null} />);

    expect(dialog()).toBeNull();
  });
});

describe("MobileMenu — ทางเข้าถึงที่ห้ามหาย (STEP 37)", () => {
  /**
   * กฎ STEP 31 ข้อ 7: จอ 360px รับไอคอนข้างโลโก้ได้แค่ 4 ตัว จึงซ่อน "ถูกใจ" จาก navbar
   * **แล้วต้องมาโผล่ในเมนูนี้** ไม่งั้นคนใช้มือถือเข้าหน้า /wishlist ไม่ได้เลย
   */
  it("มีลิงก์รายการที่ถูกใจ เพราะ navbar ซ่อนไอคอนนั้นบนจอเล็ก", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={CUSTOMER} />);

    await user.click(openButton());

    expect(screen.getByRole("link", { name: /รายการที่ถูกใจ/ }).getAttribute("href")).toBe(
      "/wishlist",
    );
  });

  it("ยังไม่ล็อกอิน เห็นปุ่มเข้าสู่ระบบ ไม่เห็นเมนูของบัญชี", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={null} />);

    await user.click(openButton());

    expect(screen.getByRole("link", { name: "เข้าสู่ระบบ" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "บัญชีของฉัน" })).toBeNull();
    expect(screen.queryByRole("button", { name: /ออกจากระบบ/ })).toBeNull();
  });

  it("ลูกค้าต้องไม่เห็นทางเข้าหลังบ้าน", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={CUSTOMER} />);

    await user.click(openButton());

    expect(screen.getByRole("link", { name: /บัญชีของฉัน/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Admin Dashboard/ })).toBeNull();
  });

  it("พนักงานเห็นทางเข้าหลังบ้าน", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={ADMIN} />);

    await user.click(openButton());

    expect(screen.getByRole("link", { name: /Admin Dashboard/ }).getAttribute("href")).toBe(
      "/admin",
    );
  });

  /** กฎ STEP 4 ข้อ 2: ห้ามใส่ href ไปยังเส้นทางที่ยังไม่มีหน้า (จะกลายเป็นลิงก์ไป 404) */
  it("ทุกลิงก์ในเมนูต้องมี href ที่ขึ้นต้นด้วย / — ไม่มีลิงก์ว่างหรือลิงก์ออกนอกเว็บ", async () => {
    const user = userEvent.setup();
    render(<MobileMenu user={CUSTOMER} />);

    await user.click(openButton());

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href !== "");

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
    }
  });
});
