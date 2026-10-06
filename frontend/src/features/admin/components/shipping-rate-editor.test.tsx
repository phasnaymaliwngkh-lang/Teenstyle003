import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShippingRateEditor } from "./shipping-rate-editor.tsx";

import type { ShippingRate } from "@/types/shipping";

vi.mock("@/services/shipping.service", () => ({
  updateShippingRate: vi.fn(() => Promise.resolve({})),
}));

const { updateShippingRate } = await import("@/services/shipping.service");

const RATE: ShippingRate = {
  code: "STANDARD",
  name: "ส่งธรรมดา",
  description: "ไปรษณีย์ไทย / Flash",
  baseFee: 50,
  freeOverSubtotal: 1000,
  etaText: "2–4 วันทำการ",
  onlyProvinces: null,
  isActive: true,
  sortOrder: 1,
  updatedAt: "2026-10-08T03:00:00.000Z",
};

const PROVINCES = ["กรุงเทพมหานคร", "นนทบุรี", "เชียงใหม่"];

const feeBox = () => screen.getByRole("textbox", { name: /^ค่าส่ง/ });
const freeBox = () => screen.getByRole("textbox", { name: /ส่งฟรีเมื่อยอดสินค้าครบ/ });
const save = () => screen.getByRole("button", { name: /^บันทึกส่งธรรมดา/ });

describe("ShippingRateEditor — แก้อัตราค่าส่ง (STEP 44)", () => {
  beforeEach(() => {
    vi.mocked(updateShippingRate).mockClear();
  });

  /** กับดักของ STEP 37: Number("abc") = NaN → JSON เป็น null → API อ่านว่า "ล้างค่า" */
  it("ค่าส่งที่ไม่ใช่ตัวเลข → ไม่ยิง API และบอกรูปแบบที่ถูก", async () => {
    const user = userEvent.setup();
    render(<ShippingRateEditor rate={RATE} provinces={PROVINCES} canEdit />);

    await user.clear(feeBox());
    await user.type(feeBox(), "ห้าสิบ");
    await user.click(save());

    expect(updateShippingRate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("ค่าส่ง");
  });

  it("ส่งเฉพาะช่องที่เปลี่ยน · ล้างยอดส่งฟรี = ยกเลิกโปร (null) · จังหวัดที่ติ๊กถูกส่งเป็นรายการ", async () => {
    const user = userEvent.setup();
    render(<ShippingRateEditor rate={RATE} provinces={PROVINCES} canEdit />);

    await user.clear(feeBox());
    await user.type(feeBox(), "65");
    await user.clear(freeBox());
    await user.click(screen.getByRole("checkbox", { name: "นนทบุรี" }));
    await user.click(save());

    expect(updateShippingRate).toHaveBeenCalledOnce();
    const [method, input] = vi.mocked(updateShippingRate).mock.calls[0]!;
    expect(method).toBe("STANDARD");
    expect(input).toEqual({ baseFee: 65, freeOverSubtotal: null, onlyProvinces: ["นนทบุรี"] });
  });

  it("ไม่ได้แก้อะไร → ไม่ยิง API · ไม่มีสิทธิ์แก้ → เห็นแค่ค่าปัจจุบัน ไม่มีช่องกรอก", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ShippingRateEditor rate={RATE} provinces={PROVINCES} canEdit />);

    await user.click(save());
    expect(updateShippingRate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("ยังไม่ได้แก้");
    unmount();

    render(<ShippingRateEditor rate={RATE} provinces={PROVINCES} canEdit={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("ทั่วประเทศ")).toBeTruthy();
  });
});
