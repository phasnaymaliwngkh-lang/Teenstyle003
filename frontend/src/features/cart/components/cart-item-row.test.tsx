import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CartItemRow } from "./cart-item-row.tsx";

import { routerMock } from "../../../../tests/helpers/next-mocks.ts";

import { ApiClientError } from "@/lib/api";
import type { CartItem } from "@/types/catalog";

/**
 * service ถูก mock ที่ระดับไฟล์ — เทสต์นี้ตรวจ **คอมโพเนนต์** ไม่ใช่ API
 * (ด่านจริงของสต็อกมีเทสต์ integration ของตัวเองอยู่ที่ backend/tests/cart.test.ts)
 */
vi.mock("@/services/cart.service", () => ({
  updateCartItem: vi.fn(() => Promise.resolve({})),
  removeCartItem: vi.fn(() => Promise.resolve({})),
  selectCartItem: vi.fn(() => Promise.resolve({})),
}));

const { updateCartItem, removeCartItem, selectCartItem } = await import("@/services/cart.service");

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "item-1",
    variantId: "variant-1",
    productId: "product-1",
    name: "เสื้อยืดโอเวอร์ไซซ์ลายกราฟิก",
    slug: "oversized-graphic-tee",
    sku: "TS-TEE-BLK-M",
    image: null,
    color: "ดำ",
    size: "M",
    quantity: 3,
    selected: true,
    unitPrice: 590,
    listPrice: 690,
    addedPrice: 590,
    priceChanged: false,
    lineTotal: 1770,
    available: 3,
    stockStatus: "IN_STOCK",
    issue: null,
    ...overrides,
  };
}

function quantityBox(): HTMLInputElement {
  return screen.getByRole("spinbutton", { name: /จำนวนของ/ });
}

describe("CartItemRow — จำนวนในตะกร้า (STEP 37)", () => {
  beforeEach(() => {
    vi.mocked(updateCartItem).mockClear();
    vi.mocked(removeCartItem).mockClear();
    vi.mocked(selectCartItem).mockClear();
  });

  it("พิมพ์จำนวนเกินที่มีในคลัง แล้วช่องต้องแสดงจำนวนที่ระบบใช้จริง ไม่ใช่เลขที่พิมพ์", async () => {
    const user = userEvent.setup();
    // ของเหลือ 3 และในตะกร้ามี 3 อยู่แล้ว → ตัวเลขที่ปัดแล้วเท่ากับของเดิม จึงไม่มีการยิง API
    render(<CartItemRow item={makeItem({ quantity: 3, available: 3 })} />);

    await user.clear(quantityBox());
    await user.type(quantityBox(), "9");
    await user.tab();

    // ไม่ยิง API ถูกต้องแล้ว (จำนวนจริงไม่เปลี่ยน) …
    expect(updateCartItem).not.toHaveBeenCalled();
    // … แต่ช่องต้องไม่ค้างเลข 9 ไว้ ไม่งั้นลูกค้าเชื่อว่าสั่ง 9 ชิ้นทั้งที่ตะกร้ามี 3
    expect(quantityBox().value).toBe("3");
  });

  it("พิมพ์ค่าว่างแล้วออกจากช่อง ต้องกลับเป็นจำนวนเดิม ไม่ใช่ช่องว่าง", async () => {
    const user = userEvent.setup();
    render(<CartItemRow item={makeItem({ quantity: 1, available: 5 })} />);

    await user.clear(quantityBox());
    await user.tab();

    expect(updateCartItem).not.toHaveBeenCalled();
    expect(quantityBox().value).toBe("1");
  });

  it("พิมพ์จำนวนที่ยังซื้อได้ ต้องยิง API ด้วยเลขนั้นแล้วสั่งให้หน้าอ่านข้อมูลใหม่", async () => {
    const user = userEvent.setup();
    render(<CartItemRow item={makeItem({ quantity: 1, available: 5 })} />);

    await user.clear(quantityBox());
    await user.type(quantityBox(), "4");
    await user.tab();

    expect(updateCartItem).toHaveBeenCalledWith("item-1", 4);
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("พิมพ์เกินคลัง โดยที่ยังปรับได้จริง ต้องส่งเลขที่ปัดแล้ว ไม่ใช่เลขที่พิมพ์", async () => {
    const user = userEvent.setup();
    render(<CartItemRow item={makeItem({ quantity: 1, available: 3 })} />);

    await user.clear(quantityBox());
    await user.type(quantityBox(), "99");
    await user.tab();

    expect(updateCartItem).toHaveBeenCalledWith("item-1", 3);
  });

  it("ปุ่มเพิ่มจำนวนถูกปิดเมื่อถึงจำนวนที่มีในคลังแล้ว", () => {
    render(<CartItemRow item={makeItem({ quantity: 3, available: 3 })} />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "เพิ่มจำนวน" }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "ลดจำนวน" }).disabled).toBe(false);
  });

  it("ปุ่มลดจำนวนถูกปิดที่ 1 ชิ้น — ลดต่อไม่ได้ ต้องใช้ปุ่มลบ", () => {
    render(<CartItemRow item={makeItem({ quantity: 1, available: 3 })} />);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "ลดจำนวน" }).disabled).toBe(true);
  });
});

describe("CartItemRow — ข้อความที่ผู้ใช้ต้องเห็น (STEP 37)", () => {
  it("ของในคลังน้อยกว่าที่อยู่ในตะกร้า ต้องบอกจำนวนที่เหลือจริง", () => {
    render(
      <CartItemRow item={makeItem({ quantity: 5, available: 2, issue: "INSUFFICIENT_STOCK" })} />,
    );

    const alert = screen.getByRole("alert");

    expect(alert.textContent).toContain("ลดจำนวนก่อนสั่งซื้อ");
    expect(alert.textContent).toContain("เหลือ 2 ชิ้น");
  });

  it("ราคาเปลี่ยนต้องบอกว่าคิดเงินด้วยราคาปัจจุบัน", () => {
    render(
      <CartItemRow item={makeItem({ addedPrice: 690, unitPrice: 590, priceChanged: true })} />,
    );

    expect(screen.getByText(/ยอดที่คิดเงินใช้ราคาปัจจุบัน/)).toBeTruthy();
  });

  it("API ปฏิเสธ ต้องแสดงข้อความจาก server ไม่ใช่ข้อความกลาง", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCartItem).mockRejectedValueOnce(
      new ApiClientError(409, "เพิ่มได้อีกแค่ 1 ชิ้น", "CONFLICT"),
    );
    render(<CartItemRow item={makeItem({ quantity: 1, available: 5 })} />);

    await user.click(screen.getByRole("button", { name: "เพิ่มจำนวน" }));

    expect(await screen.findByText("เพิ่มได้อีกแค่ 1 ชิ้น")).toBeTruthy();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("ปุ่มลบมีชื่อสินค้าอยู่ในชื่อปุ่ม — หลายรายการในหน้าเดียวต้องแยกออกจากกันได้", () => {
    render(<CartItemRow item={makeItem()} />);

    expect(
      screen.getByRole("button", { name: "ลบ เสื้อยืดโอเวอร์ไซซ์ลายกราฟิก ออกจากตะกร้า" }),
    ).toBeTruthy();
  });

  it("ติ๊กเลือกรายการยิง API ด้วยค่าที่กดจริง", async () => {
    const user = userEvent.setup();
    render(<CartItemRow item={makeItem({ selected: true })} />);

    await user.click(screen.getByRole("checkbox", { name: /เลือกรายการนี้/ }));

    expect(selectCartItem).toHaveBeenCalledWith("item-1", false);
  });
});
