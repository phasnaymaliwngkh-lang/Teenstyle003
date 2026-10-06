import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReturnRequestForm } from "./return-request-form.tsx";

import type { ReturnEligibility } from "@/types/returns";

vi.mock("@/services/returns.service", () => ({
  createReturnRequest: vi.fn(() => Promise.resolve({ id: "r1" })),
}));

const { createReturnRequest } = await import("@/services/returns.service");

function makeEligibility(overrides: Partial<ReturnEligibility> = {}): ReturnEligibility {
  return {
    orderNumber: "TS-20261006-0001",
    eligible: true,
    message: null,
    deadline: "2026-10-13T03:00:00.000Z",
    windowDays: 7,
    reasons: [
      { code: "DEFECTIVE", label: "สินค้ามีตำหนิจากการผลิต", description: "ตะเข็บแตก" },
      { code: "WRONG_ITEM", label: "ร้านส่งสินค้าผิด", description: "ผิดสี ผิดไซซ์" },
    ],
    detailMinLength: 10,
    items: [
      {
        orderItemId: "item-a",
        productName: "เสื้อยืดโอเวอร์ไซซ์",
        variantSku: "TS-TEE-BLK-M",
        colorName: "ดำ",
        sizeName: "M",
        imageUrl: null,
        unitPrice: 390,
        purchased: 2,
        returnable: 2,
      },
      {
        orderItemId: "item-b",
        productName: "กางเกงขาม้า",
        variantSku: "TS-PNT-BLU-S",
        colorName: "น้ำเงิน",
        sizeName: "S",
        imageUrl: null,
        unitPrice: 590,
        purchased: 1,
        returnable: 0,
      },
    ],
    requests: [],
    ...overrides,
  };
}

const quantityOf = (name: string) =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: new RegExp(name) });
const submit = () => screen.getByRole("button", { name: "ส่งคำขอคืนสินค้า" });

describe("ReturnRequestForm — ขอคืนสินค้า (STEP 43)", () => {
  beforeEach(() => {
    vi.mocked(createReturnRequest).mockClear();
  });

  it("เลือกได้เฉพาะชิ้นที่ยังคืนได้ และจำนวนไม่เกินที่คืนได้", () => {
    render(<ReturnRequestForm eligibility={makeEligibility()} />);

    // ชิ้นที่คืนครบแล้ว (returnable 0) ไม่มีให้เลือก
    expect(screen.queryByRole("combobox", { name: /กางเกงขาม้า/ })).toBeNull();
    // 0 (ไม่คืน) + 1 + 2 = 3 ตัวเลือก — ไม่มีทางเลือกเกินที่ซื้อ
    expect(quantityOf("เสื้อยืดโอเวอร์ไซซ์").options).toHaveLength(3);
  });

  /**
   * SECURITY: ส่งได้แค่ชิ้น · จำนวน · เหตุผล · รายละเอียด — ไม่มียอดเงินในคำขอเลย
   * ยอดที่จะได้คืนคิดที่ server ด้วยสูตรเดียวกับที่ร้านใช้ตอนคืนเงินจริง
   */
  it("ส่งเฉพาะชิ้น จำนวน เหตุผล รายละเอียด — ไม่มีฟิลด์ยอดเงิน", async () => {
    const user = userEvent.setup();
    render(<ReturnRequestForm eligibility={makeEligibility()} />);

    await user.selectOptions(quantityOf("เสื้อยืดโอเวอร์ไซซ์"), "1");
    await user.click(screen.getByRole("radio", { name: /สินค้ามีตำหนิจากการผลิต/ }));
    await user.type(screen.getByRole("textbox", { name: /เล่ารายละเอียด/ }), "ตะเข็บแขนซ้ายแตก");
    await user.click(submit());

    expect(createReturnRequest).toHaveBeenCalledOnce();

    const input = vi.mocked(createReturnRequest).mock.calls[0]![0];
    expect(input).toMatchObject({
      orderNumber: "TS-20261006-0001",
      reason: "DEFECTIVE",
      detail: "ตะเข็บแขนซ้ายแตก",
      items: [{ orderItemId: "item-a", quantity: 1 }],
    });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(input).sort()).toEqual(
      ["detail", "idempotencyKey", "items", "orderNumber", "reason"].sort(),
    );
  });

  it("ไม่เลือกชิ้น / ไม่เลือกเหตุผล / รายละเอียดสั้นเกิน → ไม่ยิง API และบอกว่าต้องแก้อะไร", async () => {
    const user = userEvent.setup();
    render(<ReturnRequestForm eligibility={makeEligibility()} />);

    await user.click(submit());
    expect(screen.getByRole("alert").textContent).toContain("เลือกสินค้า");

    await user.selectOptions(quantityOf("เสื้อยืดโอเวอร์ไซซ์"), "2");
    await user.click(submit());
    expect(screen.getByRole("alert").textContent).toContain("เหตุผล");

    await user.click(screen.getByRole("radio", { name: /ร้านส่งสินค้าผิด/ }));
    await user.type(screen.getByRole("textbox", { name: /เล่ารายละเอียด/ }), "สีผิด");
    await user.click(submit());
    expect(screen.getByRole("alert").textContent).toContain("10 ตัวอักษร");

    expect(createReturnRequest).not.toHaveBeenCalled();
  });
});
