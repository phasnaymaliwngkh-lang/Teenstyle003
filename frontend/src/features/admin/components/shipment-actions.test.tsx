import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShipmentActions } from "./shipment-actions.tsx";

import type { AdminShipmentDetail } from "@/types/shipping";

vi.mock("@/services/shipping.service", () => ({
  updateShipmentStatus: vi.fn(() => Promise.resolve({})),
  updateShipment: vi.fn(() => Promise.resolve({})),
}));

const { updateShipment, updateShipmentStatus } = await import("@/services/shipping.service");

/** คอมโพเนนต์อ่านแค่ช่องเหล่านี้ — สร้างเท่าที่ใช้แล้ว cast */
function makeShipment(overrides: Partial<AdminShipmentDetail> = {}): AdminShipmentDetail {
  return {
    id: "ship-1",
    carrier: "Kerry Express",
    trackingNumber: "KEX123456",
    estimatedDelivery: "2026-10-10T16:59:59.000Z",
    isLatest: true,
    canEdit: true,
    allowedNextStatuses: [
      { status: "IN_TRANSIT", label: "อยู่ระหว่างขนส่ง", needsNote: false },
      { status: "FAILED", label: "ส่งไม่สำเร็จ", needsNote: true },
      { status: "RETURNED", label: "ตีกลับถึงร้านแล้ว", needsNote: true },
    ],
    ...overrides,
  } as AdminShipmentDetail;
}

const saveStatus = () => screen.getByRole<HTMLButtonElement>("button", { name: /^บันทึกสถานะ/ });

describe("ShipmentActions — สถานะพัสดุ (STEP 44)", () => {
  beforeEach(() => {
    vi.mocked(updateShipmentStatus).mockClear();
    vi.mocked(updateShipment).mockClear();
  });

  it("ส่งไม่สำเร็จต้องเขียนข้อความถึงลูกค้าก่อนจึงกดบันทึกได้ · ข้อความถูกส่งไปด้วย", async () => {
    const user = userEvent.setup();
    render(<ShipmentActions shipment={makeShipment()} canUpdate />);

    await user.click(screen.getByRole("button", { name: "ส่งไม่สำเร็จ" }));
    expect(saveStatus().disabled).toBe(true);

    await user.type(
      screen.getByRole("textbox", { name: /ข้อความถึงลูกค้า/ }),
      "ไม่มีผู้รับที่บ้าน",
    );
    expect(saveStatus().disabled).toBe(false);
    await user.click(saveStatus());

    expect(updateShipmentStatus).toHaveBeenCalledWith("ship-1", {
      status: "FAILED",
      note: "ไม่มีผู้รับที่บ้าน",
    });
  });

  it("แก้เลขพัสดุต้องมีเหตุผล · ส่งเฉพาะช่องที่เปลี่ยน (ไม่แตะกำหนดส่ง = ไม่ส่ง)", async () => {
    const user = userEvent.setup();
    render(<ShipmentActions shipment={makeShipment()} canUpdate />);

    const tracking = screen.getByRole("textbox", { name: /^เลขพัสดุ/ });
    await user.clear(tracking);
    await user.type(tracking, "KEX123465");

    const fix = screen.getByRole<HTMLButtonElement>("button", { name: "บันทึกการแก้ไข" });
    expect(fix.disabled).toBe(true);

    await user.type(screen.getByRole("textbox", { name: /เหตุผลที่แก้/ }), "พิมพ์สลับหลัก");
    await user.click(fix);

    expect(updateShipment).toHaveBeenCalledWith("ship-1", {
      trackingNumber: "KEX123465",
      reason: "พิมพ์สลับหลัก",
    });
  });

  it("ไม่มีสิทธิ์แก้ หรือพัสดุจบแล้ว → ไม่มีปุ่มให้กด และบอกเหตุผล", () => {
    const { unmount } = render(<ShipmentActions shipment={makeShipment()} canUpdate={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/ไม่มีสิทธิ์แก้ไข/)).toBeTruthy();
    unmount();

    render(
      <ShipmentActions
        shipment={makeShipment({ allowedNextStatuses: [], canEdit: false, isLatest: false })}
        canUpdate
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/แก้ได้เฉพาะชิ้นล่าสุด/)).toBeTruthy();
  });
});
