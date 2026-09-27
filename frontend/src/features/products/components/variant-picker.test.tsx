import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VariantPicker } from "./variant-picker.tsx";

import { ApiClientError } from "@/lib/api";
import type { AvailabilityResult, ProductDetail, ProductVariant } from "@/types/catalog";

vi.mock("@/services/catalog.service", () => ({ checkAvailability: vi.fn() }));
vi.mock("@/services/cart.service", () => ({ addToCart: vi.fn() }));

const { checkAvailability } = await import("@/services/catalog.service");
const { addToCart } = await import("@/services/cart.service");

const BLACK = { name: "ดำ", slug: "black", hex: "#111114" };
const WHITE = { name: "ขาว", slug: "white", hex: "#ffffff" };
const M = { name: "M", code: "M" };
const L = { name: "L", code: "L" };

function variant(overrides: Partial<ProductVariant> & { id: string }): ProductVariant {
  return {
    sku: `SKU-${overrides.id}`,
    color: BLACK,
    size: M,
    price: 690,
    salePrice: 590,
    finalPrice: 590,
    available: 5,
    stockStatus: "IN_STOCK",
    ...overrides,
  };
}

function makeProduct(variants: ProductVariant[], overrides: Partial<ProductDetail> = {}) {
  const colors = [
    ...new Map(variants.flatMap((v) => (v.color ? [[v.color.slug, v.color]] : []))).values(),
  ];
  const sizes = [
    ...new Map(variants.flatMap((v) => (v.size ? [[v.size.code, v.size]] : []))).values(),
  ];

  return {
    id: "product-1",
    name: "เสื้อยืดโอเวอร์ไซซ์",
    slug: "oversized-tee",
    variants,
    colors,
    sizes,
    ...overrides,
  } as ProductDetail;
}

function availability(overrides: Partial<AvailabilityResult> = {}): AvailabilityResult {
  return {
    purchasable: true,
    available: 5,
    variant: {
      id: "v1",
      sku: "SKU-v1",
      productName: "เสื้อยืดโอเวอร์ไซซ์",
      productSlug: "oversized-tee",
      color: "ดำ",
      size: "M",
      finalPrice: 590,
    },
    ...overrides,
  };
}

const addButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: /เพิ่มลงตะกร้า|สินค้าหมด/ });
const quantityBox = () =>
  screen.getByRole<HTMLInputElement>("spinbutton", { name: "จำนวนที่ต้องการ" });

beforeEach(() => {
  vi.mocked(checkAvailability).mockReset();
  vi.mocked(addToCart).mockReset();
  vi.mocked(checkAvailability).mockResolvedValue(availability());
  vi.mocked(addToCart).mockResolvedValue({
    summary: { totalQuantity: 2, subtotal: 1180 },
  } as never);
});

describe("VariantPicker — จำนวนต้องไม่เกินที่ซื้อได้จริง (STEP 37)", () => {
  it("พิมพ์จำนวนเกินของที่มี ช่องต้องแสดงเพดานจริง ไม่ใช่เลขที่พิมพ์", async () => {
    const user = userEvent.setup();
    render(<VariantPicker product={makeProduct([variant({ id: "v1", available: 3 })])} />);

    await user.clear(quantityBox());
    await user.type(quantityBox(), "9");

    expect(quantityBox().value).toBe("3");
  });

  it("ปุ่มเพิ่ม/ลดหยุดที่ขอบเขต 1..จำนวนที่มี", async () => {
    const user = userEvent.setup();
    render(<VariantPicker product={makeProduct([variant({ id: "v1", available: 2 })])} />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "ลดจำนวน" }).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวน" }));

    expect(quantityBox().value).toBe("2");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "เพิ่มจำนวน" }).disabled).toBe(
      true,
    );
  });

  it("ของหมด ปุ่มต้องปิดและเขียนว่าสินค้าหมด", () => {
    render(
      <VariantPicker
        product={makeProduct([variant({ id: "v1", available: 0, stockStatus: "OUT_OF_STOCK" })])}
      />,
    );

    expect(addButton().disabled).toBe(true);
    expect(addButton().textContent).toContain("สินค้าหมด");
  });

  it("เปลี่ยนไซซ์ต้องรีเซ็ตจำนวนเป็น 1 — จำนวนของไซซ์เดิมใช้กับไซซ์ใหม่ไม่ได้", async () => {
    const user = userEvent.setup();
    render(
      <VariantPicker
        product={makeProduct([
          variant({ id: "v1", size: M, available: 9 }),
          variant({ id: "v2", size: L, available: 1 }),
        ])}
      />,
    );

    await user.clear(quantityBox());
    await user.type(quantityBox(), "9");
    expect(quantityBox().value).toBe("9");

    await user.click(screen.getByRole("button", { name: "L" }));

    expect(quantityBox().value).toBe("1");
  });

  it("เลือกสี/ไซซ์ที่ไม่มีคู่กันจริง ต้องบอกให้เลือกอย่างอื่น ไม่ใช่เดาให้", async () => {
    const user = userEvent.setup();
    render(
      <VariantPicker
        product={makeProduct([variant({ id: "v1", color: BLACK, size: M })], {
          colors: [BLACK, WHITE],
          sizes: [M, L],
        } as Partial<ProductDetail>)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ขาว/ }));

    expect(screen.getByText(/ไม่มีตัวเลือกนี้ในร้าน/)).toBeTruthy();
    expect(addButton().disabled).toBe(true);
  });
});

describe("VariantPicker — คำตอบของ server ชนะค่าที่ถืออยู่ฝั่ง client (STEP 37)", () => {
  /**
   * กฎ STEP 6 ข้อ 2: ก่อนเพิ่มลงตะกร้าต้องถาม server ทุกครั้ง แล้ว **เชื่อคำตอบของ server**
   * ค่า `available` ที่มากับหน้ามีไว้จำกัด input เท่านั้น — ของอาจถูกคนอื่นซื้อไปแล้ว
   */
  it("ต้องถามสต็อกกับ server ก่อนเพิ่มลงตะกร้าเสมอ", async () => {
    const user = userEvent.setup();
    render(<VariantPicker product={makeProduct([variant({ id: "v1" })])} />);

    await user.click(addButton());

    expect(checkAvailability).toHaveBeenCalledWith("v1", 1);
    expect(addToCart).toHaveBeenCalledWith("v1", 1);
  });

  it("server บอกว่าซื้อไม่ได้ ต้องไม่เพิ่มลงตะกร้า และปรับจำนวนตามที่ server บอก", async () => {
    const user = userEvent.setup();
    vi.mocked(checkAvailability).mockResolvedValue(
      availability({ purchasable: false, reason: "INSUFFICIENT_STOCK", available: 2 }),
    );
    render(<VariantPicker product={makeProduct([variant({ id: "v1", available: 5 })])} />);

    await user.clear(quantityBox());
    await user.type(quantityBox(), "5");
    await user.click(addButton());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(addToCart).not.toHaveBeenCalled();
    expect(screen.getByText(/ซื้อได้จริงตอนนี้ 2 ชิ้น/)).toBeTruthy();
    expect(quantityBox().value).toBe("2");
  });

  it("ของหมดระหว่างที่เปิดหน้าอยู่ ต้องบอกว่าหมด ไม่ใช่เงียบ", async () => {
    const user = userEvent.setup();
    vi.mocked(checkAvailability).mockResolvedValue(
      availability({ purchasable: false, reason: "OUT_OF_STOCK", available: 0 }),
    );
    render(<VariantPicker product={makeProduct([variant({ id: "v1" })])} />);

    await user.click(addButton());

    expect((await screen.findByRole("alert")).textContent).toContain("สินค้าตัวเลือกนี้หมดแล้ว");
    expect(addToCart).not.toHaveBeenCalled();
  });

  it("ด่านที่สอง (ตะกร้า) ปฏิเสธ ต้องแสดงข้อความจาก server ไม่ใช่บอกว่าสำเร็จ", async () => {
    const user = userEvent.setup();
    vi.mocked(addToCart).mockRejectedValue(
      new ApiClientError(409, "เพิ่มได้อีกแค่ 1 ชิ้น", "CONFLICT"),
    );
    render(<VariantPicker product={makeProduct([variant({ id: "v1" })])} />);

    await user.click(addButton());

    expect((await screen.findByRole("alert")).textContent).toContain("เพิ่มได้อีกแค่ 1 ชิ้น");
    expect(screen.queryByText(/เพิ่มลงตะกร้าแล้ว/)).toBeNull();
  });

  it("สำเร็จแล้วบอกยอดในตะกร้าจาก server และมีทางไปตะกร้าต่อ", async () => {
    const user = userEvent.setup();
    render(<VariantPicker product={makeProduct([variant({ id: "v1" })])} />);

    await user.click(addButton());

    expect(await screen.findByText(/เพิ่มลงตะกร้าแล้ว/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "ไปที่ตะกร้า" }).getAttribute("href")).toBe("/cart");
  });

  it("เปลี่ยนตัวเลือกหลังเพิ่มสำเร็จ ผลเดิมต้องหายไป — ผลตรวจของ variant เก่าใช้ไม่ได้", async () => {
    const user = userEvent.setup();
    render(
      <VariantPicker
        product={makeProduct([variant({ id: "v1", size: M }), variant({ id: "v2", size: L })])}
      />,
    );

    await user.click(addButton());
    expect(await screen.findByText(/เพิ่มลงตะกร้าแล้ว/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "L" }));

    expect(screen.queryByText(/เพิ่มลงตะกร้าแล้ว/)).toBeNull();
  });
});
