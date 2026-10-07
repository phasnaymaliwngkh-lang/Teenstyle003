import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { routerMock } from "../../../../tests/helpers/next-mocks.ts";

import { ProductImageManager } from "./product-image-manager.tsx";

import { ApiClientError } from "@/lib/api";
import type { AdminProductImage, ProductFormOptions } from "@/types/admin";

vi.mock("@/services/admin.service", () => ({
  uploadProductImage: vi.fn(),
  updateProductImageAlt: vi.fn(),
  reorderProductImages: vi.fn(),
  removeProductImage: vi.fn(),
}));

const { uploadProductImage, updateProductImageAlt, reorderProductImages, removeProductImage } =
  await import("@/services/admin.service");

const RULES: ProductFormOptions["imageUpload"] = {
  maxBytes: 8 * 1024 * 1024,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  acceptedText: "JPEG, PNG, WebP หรือ AVIF",
  minShortEdge: 600,
  maxImages: 10,
};

function image(id: string, index: number, overrides: Partial<AdminProductImage> = {}) {
  return {
    id,
    url: `/media/products/2026/10/${id}.webp`,
    alt: `รูป ${id}`,
    isMain: index === 0,
    sortOrder: index,
    uploaded: true,
    ...overrides,
  } satisfies AdminProductImage;
}

const FRONT = image("aaaaaaaa-0000-4000-8000-000000000001", 0);
const BACK = image("aaaaaaaa-0000-4000-8000-000000000002", 1);

function renderManager(images: AdminProductImage[] = [FRONT, BACK], isActive = false) {
  return render(
    <ProductImageManager
      productId="product-1"
      productName="เสื้อทดสอบ"
      isActive={isActive}
      initialImages={images}
      rules={RULES}
    />,
  );
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeAll(() => {
  // jsdom ไม่มี object URL — ภาพตัวอย่างก่อนอัปโหลดใช้แค่เป็น src ของ <img>
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterAll(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

beforeEach(() => {
  vi.mocked(uploadProductImage).mockReset();
  vi.mocked(updateProductImageAlt).mockReset();
  vi.mocked(reorderProductImages).mockReset();
  vi.mocked(removeProductImage).mockReset();
});

describe("ProductImageManager — รูปสินค้า (STEP 47)", () => {
  it("รูปแรกคือรูปหลัก · 'ตั้งเป็นรูปหลัก' ส่งลำดับใหม่ของทุกรูปให้ server แล้วใช้ผลที่ server ตอบ", async () => {
    vi.mocked(reorderProductImages).mockResolvedValue([
      { ...BACK, isMain: true, sortOrder: 0 },
      { ...FRONT, isMain: false, sortOrder: 1 },
    ]);
    const user = userEvent.setup();
    renderManager();

    // บรรทัดหัวของการ์ด ("รูปที่ n" + ป้าย) — ไม่นับปุ่ม "ตั้งเป็นรูปหลัก" ที่มีคำเดียวกัน
    const titleOf = (index: number) =>
      screen.getAllByRole("listitem")[index]?.querySelector("p")?.textContent;
    expect(titleOf(0)).toBe("รูปที่ 1รูปหลัก");
    expect(titleOf(1)).toBe("รูปที่ 2");

    await user.click(screen.getByRole("button", { name: "ตั้งเป็นรูปหลัก" }));

    expect(reorderProductImages).toHaveBeenCalledWith("product-1", [BACK.id, FRONT.id]);
    expect(await screen.findByText("ตั้งเป็นรูปหลักแล้ว")).toBeTruthy();
    expect((screen.getByLabelText("คำอธิบายรูปที่ 1 (alt)") as HTMLInputElement).value).toBe(
      BACK.alt,
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("เลื่อนรูปไปถัดไป = สลับกับรูปข้างหลัง (ส่งรายการครบ ไม่ส่งแค่สองรูป)", async () => {
    const third = image("aaaaaaaa-0000-4000-8000-000000000003", 2);
    vi.mocked(reorderProductImages).mockResolvedValue([FRONT, third, BACK]);
    const user = userEvent.setup();
    renderManager([FRONT, BACK, third]);

    await user.click(screen.getByRole("button", { name: "เลื่อนรูปที่ 2 ไปถัดไป" }));

    expect(reorderProductImages).toHaveBeenCalledWith("product-1", [FRONT.id, third.id, BACK.id]);
  });

  it("ไฟล์ผิดชนิดหรือใหญ่เกินไม่ถูกส่ง และบอกเหตุผล · ไฟล์ที่ผ่านถูกส่งพร้อมคำอธิบายรูป", async () => {
    const added = image("aaaaaaaa-0000-4000-8000-000000000009", 2);
    vi.mocked(uploadProductImage).mockResolvedValue([FRONT, BACK, added]);
    // ปิด applyAccept เพื่อจำลองผู้ใช้ที่เลือก "ทุกไฟล์" ในหน้าต่างเลือกไฟล์
    const user = userEvent.setup({ applyAccept: false });
    renderManager();

    const gif = new File(["gif"], "animated.gif", { type: "image/gif" });
    const huge = new File([new Uint8Array(RULES.maxBytes + 1)], "huge.jpg", { type: "image/jpeg" });
    const good = new File(["jpeg"], "front.jpg", { type: "image/jpeg" });

    await user.upload(screen.getByLabelText(/เลือกรูป/), [gif, huge, good]);

    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts.some((text) => text?.includes("รับเฉพาะ"))).toBe(true);
    expect(alerts.some((text) => text?.includes("สูงสุด 8 MB"))).toBe(true);

    const altBox = screen.getByLabelText(/ของไฟล์ front\.jpg/);
    await user.clear(altBox);
    await user.type(altBox, "  เสื้อด้านหน้า  ");
    await user.click(screen.getByRole("button", { name: /อัปโหลด 1 รูป/ }));

    expect(uploadProductImage).toHaveBeenCalledTimes(1);
    expect(uploadProductImage).toHaveBeenCalledWith("product-1", good, "เสื้อด้านหน้า");
    expect(await screen.findByText("อัปโหลดแล้ว 1 รูป")).toBeTruthy();
    expect(screen.queryByLabelText(/ของไฟล์ front\.jpg/)).toBeNull();
    expect(screen.getByRole("heading", { name: /รูปสินค้า \(3\/10\)/ })).toBeTruthy();
  });

  it("server ปฏิเสธ → ไฟล์ค้างในคิวพร้อมเหตุผลจาก server ไม่หายไปเงียบ ๆ", async () => {
    vi.mocked(uploadProductImage).mockRejectedValue(
      new ApiClientError(
        400,
        "รูปเล็กเกินไป (300 × 300 px) — ด้านที่สั้นที่สุดต้องยาวอย่างน้อย 600 px",
        "BAD_REQUEST",
      ),
    );
    const user = userEvent.setup();
    renderManager();

    await user.upload(
      screen.getByLabelText(/เลือกรูป/),
      new File(["jpeg"], "small.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: /อัปโหลด 1 รูป/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("เล็กเกินไป");
    });
    expect(screen.getByLabelText(/ของไฟล์ small\.jpg/)).toBeTruthy();
    expect(routerMock.refresh).not.toHaveBeenCalled();

    // ไฟล์ที่ server ปฏิเสธลองใหม่ได้ด้วยการกดอีกครั้ง (เช่นระบบล่มชั่วคราว) — ไม่ถูกนับว่าใช้ไม่ได้ถาวร
    expect(screen.getByRole("button", { name: /อัปโหลด 1 รูป/ })).toBeTruthy();
  });

  it("คำอธิบายรูปว่าง → ไม่ส่งไฟล์นั้น และบอกให้ใส่คำอธิบาย", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.upload(
      screen.getByLabelText(/เลือกรูป/),
      new File(["jpeg"], "x.jpg", { type: "image/jpeg" }),
    );
    await user.clear(screen.getByLabelText(/ของไฟล์ x\.jpg/));
    await user.click(screen.getByRole("button", { name: /อัปโหลด 1 รูป/ }));

    expect(uploadProductImage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("คำอธิบายรูป");
  });

  it("ถอดรูปต้องกดยืนยันก่อน", async () => {
    vi.mocked(removeProductImage).mockResolvedValue([FRONT]);
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole("button", { name: "ถอดรูปที่ 2" }));
    expect(removeProductImage).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /ยืนยันถอดรูปที่ 2/ }));
    expect(removeProductImage).toHaveBeenCalledWith("product-1", BACK.id);
    expect(await screen.findByText("ถอดรูปแล้ว")).toBeTruthy();
  });

  it("สินค้าที่เปิดขายถอดรูปสุดท้ายไม่ได้ (ปุ่มบอกเหตุผล)", () => {
    renderManager([FRONT], true);

    const remove = screen.getByRole("button", { name: /ถอดรูปที่ 1 ไม่ได้/ });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
  });

  it("รูปครบจำนวนแล้วเลือกไฟล์เพิ่มไม่ได้", () => {
    const full = Array.from({ length: RULES.maxImages }, (_, index) =>
      image(`aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`, index),
    );
    renderManager(full);

    expect((screen.getByLabelText(/เลือกรูป/) as HTMLInputElement).disabled).toBe(true);
  });

  it("แก้คำอธิบายรูป → ส่งค่าที่ตัดช่องว่างแล้ว", async () => {
    vi.mocked(updateProductImageAlt).mockResolvedValue([{ ...FRONT, alt: "ด้านหน้า" }, BACK]);
    const user = userEvent.setup();
    renderManager();

    const box = screen.getByLabelText("คำอธิบายรูปที่ 1 (alt)");
    await user.clear(box);
    await user.type(box, " ด้านหน้า ");
    await user.click(screen.getByRole("button", { name: "บันทึกคำอธิบายรูปที่ 1" }));

    expect(updateProductImageAlt).toHaveBeenCalledWith("product-1", FRONT.id, "ด้านหน้า");
  });
});
