import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockAdjustForm } from "./stock-adjust-form.tsx";

import { ApiClientError } from "@/lib/api";
import type { AdjustStockInput, InventoryRow } from "@/types/admin";

vi.mock("@/services/admin.service", () => ({
  adjustStock: vi.fn(() =>
    Promise.resolve({ inventory: { quantity: 12, reserved: 0, available: 12 } }),
  ),
}));

const { adjustStock } = await import("@/services/admin.service");

function makeRow(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    variantId: "variant-1",
    sku: "TS-TEE-BLK-M",
    isActive: true,
    quantity: 10,
    reserved: 0,
    available: 10,
    minimumStock: 5,
    stockStatus: "IN_STOCK",
    location: null,
    color: { name: "ดำ", slug: "black", hex: "#111114" },
    size: { name: "M", code: "M" },
    product: {
      id: "product-1",
      name: "เสื้อยืดโอเวอร์ไซซ์",
      slug: "oversized-tee",
      sku: "TS-TEE",
      status: "ACTIVE",
      category: { name: "เสื้อ", slug: "tops" },
    },
    updatedAt: "2026-09-27T00:00:00.000Z",
    ...overrides,
  };
}

const amountBox = (label: RegExp) => screen.getByRole("textbox", { name: label });
const reasonBox = () => screen.getByRole("textbox", { name: /เหตุผล/ });
const saveButton = () => screen.getByRole<HTMLButtonElement>("button", { name: /^บันทึก/ });

function lastInput(): AdjustStockInput {
  const calls = vi.mocked(adjustStock).mock.calls;

  return calls[calls.length - 1]![1];
}

describe("StockAdjustForm — ชนิดของรายการ (STEP 37)", () => {
  beforeEach(() => {
    vi.mocked(adjustStock).mockClear();
  });

  it("รับของเข้าส่ง quantity และต้องไม่ส่ง countedQuantity", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "รับของจากผู้ผลิต ล็อต A");
    await user.click(saveButton());

    expect(adjustStock).toHaveBeenCalledOnce();
    expect(lastInput()).toMatchObject({ type: "STOCK_IN", quantity: 5 });
    expect(lastInput()).not.toHaveProperty("countedQuantity");
  });

  /**
   * กฎ STEP 15 ข้อ 4: การตรวจนับกรอก **ยอดที่นับได้** ไม่ใช่ผลต่าง
   * ถ้าฟอร์มส่งผลต่างมา ยอดในคลังจะเพี้ยนทุกครั้งที่นับ โดยไม่มี error ให้เห็น
   */
  it("ตรวจนับส่ง countedQuantity เป็นยอดที่นับได้ ไม่ใช่ผลต่าง และต้องไม่ส่ง quantity", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow({ quantity: 10 })} />);

    await user.click(screen.getByRole("button", { name: /ปรับตามการตรวจนับ/ }));
    await user.type(amountBox(/ยอดที่นับได้จริง/), "7");
    await user.type(reasonBox(), "ตรวจนับประจำเดือน");
    await user.click(saveButton());

    expect(lastInput()).toMatchObject({ type: "ADJUSTMENT", countedQuantity: 7 });
    expect(lastInput()).not.toHaveProperty("quantity");
  });

  it('เปลี่ยนชนิดรายการต้องล้างจำนวนที่กรอกไว้ — 5 ที่หมายถึง "รับเข้า 5" ไม่ใช่ "นับได้ 5"', async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.click(screen.getByRole("button", { name: /ปรับตามการตรวจนับ/ }));

    expect(amountBox(/ยอดที่นับได้จริง/)).toHaveProperty("value", "");
  });
});

describe("StockAdjustForm — ด่านก่อนยิง API (STEP 37)", () => {
  beforeEach(() => {
    vi.mocked(adjustStock).mockClear();
  });

  it("เหตุผลสั้นกว่า 3 ตัวอักษร กดบันทึกไม่ได้", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "ab");

    expect(saveButton().disabled).toBe(true);
  });

  it("เหตุผลที่เป็นช่องว่างล้วนไม่นับ — ต้องมีคนรับผิดชอบของที่หายจริง", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "     ");

    expect(saveButton().disabled).toBe(true);
  });

  it("ทศนิยมกดบันทึกไม่ได้ — สต็อกเป็นจำนวนเต็ม", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "2.5");
    await user.type(reasonBox(), "รับของจากผู้ผลิต");

    expect(saveButton().disabled).toBe(true);
  });

  it("นับได้เท่าเดิมกดบันทึกไม่ได้ และบอกตรง ๆ ว่าไม่มีอะไรต้องปรับ", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow({ quantity: 10 })} />);

    await user.click(screen.getByRole("button", { name: /ปรับตามการตรวจนับ/ }));
    await user.type(amountBox(/ยอดที่นับได้จริง/), "10");
    await user.type(reasonBox(), "ตรวจนับประจำเดือน");

    expect(screen.getByText(/ยอดที่นับได้ตรงกับระบบอยู่แล้ว/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("ลดยอดต่ำกว่าของที่ลูกค้าจองไว้ กดไม่ได้ และบอกว่าต้องจัดการคำสั่งซื้อก่อน", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow({ quantity: 10, reserved: 6, available: 4 })} />);

    await user.click(screen.getByRole("button", { name: /ตัดของออก/ }));
    await user.type(amountBox(/จำนวน/), "8");
    await user.type(reasonBox(), "ของชำรุดจากการขนส่ง");

    expect(screen.getByText(/ต่ำกว่าของที่ลูกค้าจองไว้/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  /**
   * เจอตอน STEP 37: ตัดออกมากกว่าของที่มีในคลังทั้งที่ **ไม่มีใครจองไว้เลย**
   * กลับได้ข้อความว่า "ต่ำกว่าของที่ลูกค้าจองไว้ (0 ชิ้น) — ต้องจัดการคำสั่งซื้อเหล่านั้นก่อน"
   * แอดมินจะไปไล่หาคำสั่งซื้อที่ไม่มีอยู่ ทั้งที่สาเหตุจริงคือตัดออกเกินของที่มี
   */
  it("ตัดออกเกินของที่มีในคลัง ต้องบอกสาเหตุจริง ไม่ใช่โทษว่ามีคนจองไว้", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow({ quantity: 10, reserved: 0, available: 10 })} />);

    await user.click(screen.getByRole("button", { name: /ตัดของออก/ }));
    await user.type(amountBox(/จำนวน/), "15");
    await user.type(reasonBox(), "ของชำรุดจากการขนส่ง");

    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText(/ต้องจัดการคำสั่งซื้อเหล่านั้นก่อน/)).toBeNull();
    expect(screen.getByText(/มีอยู่ในคลังแค่ 10 ชิ้น/)).toBeTruthy();
  });
});

describe("StockAdjustForm — กันยอดขยับสองเท่า (STEP 37)", () => {
  beforeEach(() => {
    vi.mocked(adjustStock).mockClear();
  });

  it("ลองใหม่หลังยิงไม่ผ่าน ต้องใช้ idempotencyKey เดิม ไม่งั้นรับของเข้าซ้ำสองรอบ", async () => {
    const user = userEvent.setup();
    vi.mocked(adjustStock).mockRejectedValueOnce(
      new ApiClientError(503, "ติดต่อฐานข้อมูลไม่ได้", "SERVICE_UNAVAILABLE"),
    );
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "รับของจากผู้ผลิต");
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toBeTruthy();

    const firstKey = lastInput().idempotencyKey;

    await user.click(saveButton());

    expect(adjustStock).toHaveBeenCalledTimes(2);
    expect(lastInput().idempotencyKey).toBe(firstKey);
  });

  it("บันทึกสำเร็จแล้วรายการถัดไปต้องได้คีย์ใหม่ ไม่งั้นถูกมองว่าเป็นรายการเดิมแล้วเงียบหาย", async () => {
    const user = userEvent.setup();
    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "รับของจากผู้ผลิต ล็อต A");
    await user.click(saveButton());
    expect(await screen.findByText(/บันทึกแล้ว/)).toBeTruthy();

    const firstKey = lastInput().idempotencyKey;

    await user.type(amountBox(/จำนวน/), "3");
    await user.type(reasonBox(), "รับของจากผู้ผลิต ล็อต B");
    await user.click(saveButton());

    expect(lastInput().idempotencyKey).not.toBe(firstKey);
    expect(lastInput().idempotencyKey).toBeTruthy();
  });

  it("บันทึกสำเร็จต้องล้างฟอร์มและสั่งให้หน้าอ่านยอดใหม่", async () => {
    const user = userEvent.setup();
    const { routerMock } = await import("../../../../tests/helpers/next-mocks.ts");

    render(<StockAdjustForm row={makeRow()} />);

    await user.type(amountBox(/จำนวน/), "5");
    await user.type(reasonBox(), "รับของจากผู้ผลิต");
    await user.click(saveButton());

    expect(await screen.findByText(/บันทึกแล้ว/)).toBeTruthy();
    expect(amountBox(/จำนวน/)).toHaveProperty("value", "");
    expect(reasonBox()).toHaveProperty("value", "");
    expect(routerMock.refresh).toHaveBeenCalled();
  });
});
