import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VariantManager } from "./variant-manager.tsx";

import { ApiClientError } from "@/lib/api";
import type { AdminProduct, AdminProductVariant, ProductFormOptions } from "@/types/admin";

vi.mock("@/services/admin.service", () => ({
  updateProductVariant: vi.fn(),
  createProductVariant: vi.fn(),
}));

const { updateProductVariant } = await import("@/services/admin.service");

function makeVariant(overrides: Partial<AdminProductVariant> = {}): AdminProductVariant {
  return {
    id: "variant-1",
    sku: "TS-TEE-BLK-M",
    barcode: null,
    price: 590,
    salePrice: null,
    finalPrice: 590,
    overridesPrice: true,
    isActive: true,
    color: { name: "ดำ", slug: "black", hex: "#111114" },
    size: { name: "M", code: "M" },
    quantity: 10,
    reserved: 0,
    available: 10,
    ...overrides,
  };
}

function makeProduct(variants: AdminProductVariant[]): AdminProduct {
  return {
    id: "product-1",
    name: "เสื้อยืดโอเวอร์ไซซ์",
    price: 690,
    salePrice: null,
    finalPrice: 690,
    variants,
  } as AdminProduct;
}

const OPTIONS = {
  categories: [],
  brands: [],
  colors: [{ name: "ดำ", slug: "black", hex: "#111114" }],
  sizes: [{ name: "M", code: "M" }],
  allowedImageHosts: ["images.unsplash.com"],
  imageUpload: {
    maxBytes: 8 * 1024 * 1024,
    acceptedTypes: ["image/jpeg"],
    acceptedText: "JPEG",
    minShortEdge: 600,
    maxImages: 10,
  },
} satisfies ProductFormOptions;

const priceBox = () => screen.getByRole("textbox", { name: /^ราคาเฉพาะตัวเลือกนี้/ });
const salePriceBox = () => screen.getByRole("textbox", { name: /ราคาลดของตัวเลือกนี้/ });
const savePriceButton = () => screen.getByRole("button", { name: /บันทึกราคา \/ บาร์โค้ด/ });

function renderRow(variant: AdminProductVariant = makeVariant()) {
  return render(<VariantManager product={makeProduct([variant])} options={OPTIONS} />);
}

function lastPatch() {
  const calls = vi.mocked(updateProductVariant).mock.calls;

  return calls[calls.length - 1]![2];
}

beforeEach(() => {
  vi.mocked(updateProductVariant).mockReset();
  vi.mocked(updateProductVariant).mockResolvedValue(makeProduct([makeVariant()]));
});

describe("VariantManager — ราคาที่พิมพ์ผิดต้องไม่เปลี่ยนราคาที่เก็บเงินจริง (STEP 37)", () => {
  /**
   * เจอตอน STEP 37 และเป็นบั๊กเรื่องเงิน:
   * `Number("abc")` = `NaN` แล้ว `JSON.stringify` แปลง `NaN` เป็น **`null`**
   * ซึ่ง API อ่านว่า "ล้างราคาของตัวเลือกนี้" (ให้กลับไปใช้ราคาสินค้าแม่)
   * → พิมพ์ผิดหนึ่งตัวอักษรแล้วราคาที่ลูกค้าจ่ายเปลี่ยน โดยหน้าจอตอบว่า "บันทึกแล้ว"
   */
  it("พิมพ์ราคาที่ไม่ใช่ตัวเลข ต้องไม่ยิง API และต้องไม่กลายเป็นการล้างราคา", async () => {
    const user = userEvent.setup();
    renderRow(makeVariant({ price: 590, overridesPrice: true }));

    await user.clear(priceBox());
    await user.type(priceBox(), "abc");
    await user.click(savePriceButton());

    expect(updateProductVariant).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/ตัวเลข/);
  });

  it("ราคาติดลบต้องไม่ถูกส่งไป", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.clear(priceBox());
    await user.type(priceBox(), "-100");
    await user.click(savePriceButton());

    expect(updateProductVariant).not.toHaveBeenCalled();
  });

  it("ราคาลดที่พิมพ์ผิดต้องไม่กลายเป็นการยกเลิกส่วนลดเงียบ ๆ", async () => {
    const user = userEvent.setup();
    renderRow(makeVariant({ price: 590, salePrice: 490, overridesPrice: true }));

    await user.clear(salePriceBox());
    await user.type(salePriceBox(), "4 9 0");
    await user.click(savePriceButton());

    expect(updateProductVariant).not.toHaveBeenCalled();
  });

  it("เว้นช่องราคาว่างยังต้องล้างราคาได้ตามเดิม — ว่างคือเจตนา ไม่ใช่พิมพ์ผิด", async () => {
    const user = userEvent.setup();
    renderRow(makeVariant({ price: 590, overridesPrice: true }));

    await user.clear(priceBox());
    await user.click(savePriceButton());

    expect(updateProductVariant).toHaveBeenCalledOnce();
    expect(lastPatch()).toMatchObject({ price: null, salePrice: null });
  });

  it("ราคาที่ถูกต้องส่งเป็นตัวเลข", async () => {
    const user = userEvent.setup();
    renderRow(makeVariant({ price: 590, overridesPrice: true }));

    await user.clear(priceBox());
    await user.type(priceBox(), "620.50");
    await user.click(savePriceButton());

    expect(lastPatch()).toMatchObject({ price: 620.5 });
  });
});

describe("VariantManager — ข้อความจาก server (STEP 37)", () => {
  /** กฎ STEP 14 ข้อ 3 — กฎราคาอยู่ที่ server ที่เดียว หน้าเว็บต้องส่งต่อเหตุผลให้ครบ */
  it("ตั้งราคาลดโดยไม่มีราคาของตัวเอง ต้องแสดงเหตุผลจริงจาก server", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProductVariant).mockRejectedValueOnce(
      new ApiClientError(
        400,
        "ถ้าจะตั้งราคาลดของตัวเลือก ต้องกำหนดราคาของตัวเลือกนั้นด้วย (ไม่กำหนด = ใช้ราคาและโปรโมชันของสินค้าแม่)",
        "BAD_REQUEST",
      ),
    );
    renderRow(makeVariant({ overridesPrice: false, price: 690 }));

    await user.type(salePriceBox(), "490");
    await user.click(savePriceButton());

    expect((await screen.findByRole("alert")).textContent).toContain(
      "ต้องกำหนดราคาของตัวเลือกนั้นด้วย",
    );
  });

  it('บาร์โค้ดซ้ำ ต้องบอกว่าซ้ำ ไม่ใช่ "บันทึกไม่สำเร็จ" ลอย ๆ', async () => {
    const user = userEvent.setup();
    vi.mocked(updateProductVariant).mockRejectedValueOnce(
      new ApiClientError(409, "บาร์โค้ดนี้ถูกใช้กับตัวเลือกอื่นแล้ว", "CONFLICT"),
    );
    renderRow();

    await user.click(savePriceButton());

    expect((await screen.findByRole("alert")).textContent).toContain(
      "บาร์โค้ดนี้ถูกใช้กับตัวเลือกอื่นแล้ว",
    );
  });

  it("ช่องราคาว่างเมื่อตัวเลือกไม่ได้กำหนดราคาเอง — ห้ามเดาจากการเทียบตัวเลขกับสินค้าแม่", () => {
    renderRow(makeVariant({ overridesPrice: false, price: 690 }));

    expect(priceBox()).toHaveProperty("value", "");
  });

  it("จำนวนในคลังแก้จากหน้านี้ไม่ได้ และต้องบอกว่าไปแก้ที่ไหน", () => {
    renderRow();

    expect(screen.getByText(/จำนวนในคลังแก้จากหน้านี้ไม่ได้/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "คลังสินค้า" }).getAttribute("href")).toBe(
      "/admin/inventory",
    );
  });
});
