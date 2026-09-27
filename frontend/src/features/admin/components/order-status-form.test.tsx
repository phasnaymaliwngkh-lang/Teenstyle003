import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderStatusForm } from "./order-status-form.tsx";

import { routerMock } from "../../../../tests/helpers/next-mocks.ts";

import { ApiClientError } from "@/lib/api";
import type { AdminOrder, UpdateOrderStatusInput } from "@/types/admin";

vi.mock("@/services/admin.service", () => ({
  updateOrderStatus: vi.fn(),
}));

const { updateOrderStatus } = await import("@/services/admin.service");

/**
 * ฟอร์มนี้อ่านจาก `order` แค่ 4 ช่อง — สร้างเท่าที่ใช้ แล้ว cast
 * (ยัด AdminOrder ทั้งก้อนลงเทสต์ทำให้เห็นไม่ชัดว่าอะไรมีผลกับพฤติกรรมจริง)
 */
function makeOrder(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    orderNumber: "TS26090001",
    status: "PACKING",
    adminNote: null,
    allowedNextStatuses: ["SHIPPING", "CANCELLED"],
    ...overrides,
  } as AdminOrder;
}

const saveButton = () => screen.getByRole<HTMLButtonElement>("button", { name: /^บันทึกสถานะ/ });
const carrierBox = () => screen.getByRole("textbox", { name: /ผู้ให้บริการขนส่ง/ });
const trackingBox = () => screen.getByRole("textbox", { name: /เลขพัสดุจริง/ });

function lastInput(): UpdateOrderStatusInput {
  const calls = vi.mocked(updateOrderStatus).mock.calls;

  return calls[calls.length - 1]![1];
}

beforeEach(() => {
  vi.mocked(updateOrderStatus).mockReset();
  vi.mocked(updateOrderStatus).mockResolvedValue({
    ...makeOrder(),
    status: "SHIPPING",
    allowedNextStatuses: ["DELIVERED"],
  });
});

describe("OrderStatusForm — เลขพัสดุต้องเป็นของจริง (STEP 37)", () => {
  it('เลือก "จัดส่งแล้ว" ต้องมีช่องขนส่งและเลขพัสดุโผล่มา', async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));

    expect(carrierBox()).toBeTruthy();
    expect(trackingBox()).toBeTruthy();
  });

  /**
   * กฎ STEP 13 ข้อ 2: เปลี่ยนเป็น SHIPPING ต้องมี carrier + trackingNumber จริง
   * ปล่อยให้กดได้แล้วรอ server ปฏิเสธ = แอดมินได้ 422 ที่ไม่บอกว่าช่องไหนว่าง
   * ทั้งที่ฟอร์มรู้อยู่แล้วตั้งแต่ก่อนกด (ช่องมีดอกจันกำกับว่าบังคับด้วย)
   */
  it("ยังไม่กรอกขนส่ง/เลขพัสดุ ต้องกดบันทึกไม่ได้ — ไม่ใช่ยิงไปให้ server ปฏิเสธ", async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));

    expect(saveButton().disabled).toBe(true);
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it("กรอกแค่ขนส่งยังไม่พอ — เลขพัสดุก็ต้องมี", async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    await user.type(carrierBox(), "Flash Express");

    expect(saveButton().disabled).toBe(true);
  });

  it("ช่องว่างล้วนไม่นับเป็นเลขพัสดุ", async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    await user.type(carrierBox(), "Flash Express");
    await user.type(trackingBox(), "    ");

    expect(saveButton().disabled).toBe(true);
  });

  it("กรอกครบแล้วส่งค่าที่ตัดช่องว่างหัวท้ายแล้ว", async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    await user.type(carrierBox(), "  Flash Express  ");
    await user.type(trackingBox(), "  TH1234567890  ");
    await user.click(saveButton());

    expect(lastInput()).toMatchObject({
      status: "SHIPPING",
      carrier: "Flash Express",
      trackingNumber: "TH1234567890",
    });
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("สถานะอื่นต้องไม่ส่งช่องพัสดุไปด้วยเลย", async () => {
    const user = userEvent.setup();
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: /ยกเลิก/ }));
    await user.click(saveButton());

    expect(lastInput()).not.toHaveProperty("carrier");
    expect(lastInput()).not.toHaveProperty("trackingNumber");
  });
});

describe("OrderStatusForm — ข้อความที่แอดมินได้อ่าน (STEP 37)", () => {
  /**
   * กฎ STEP 26 ข้อ 10: ต้องอ่านรายละเอียดจาก `details` ไม่ใช่ `.message` เฉย ๆ
   * "ข้อมูลที่ส่งมาไม่ถูกต้อง" ลอย ๆ ไม่บอกแอดมินว่าต้องไปแก้ช่องไหน
   */
  it("server ปฏิเสธพร้อมรายละเอียดช่องที่ผิด ต้องแสดงรายละเอียดนั้นด้วย", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrderStatus).mockRejectedValueOnce(
      new ApiClientError(422, "ข้อมูลที่ส่งมาไม่ถูกต้อง", "VALIDATION_ERROR", [
        { field: "trackingNumber", message: "เลขพัสดุใช้ได้เฉพาะตัวอักษร ตัวเลข และขีดกลาง" },
      ]),
    );
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    await user.type(carrierBox(), "Flash Express");
    await user.type(trackingBox(), "TH-123");
    await user.click(saveButton());

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("เลขพัสดุใช้ได้เฉพาะตัวอักษร ตัวเลข และขีดกลาง");
  });

  it("ยิงไม่ผ่านต้องไม่สั่งให้หน้าอ่านข้อมูลใหม่ — ไม่มีอะไรเปลี่ยน", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrderStatus).mockRejectedValueOnce(
      new ApiClientError(409, "เปลี่ยนสถานะจาก PACKING เป็น DELIVERED ไม่ได้", "CONFLICT"),
    );
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: /ยกเลิก/ }));
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("คำสั่งซื้อที่ไปต่อไม่ได้ ต้องไม่มีฟอร์มให้กดเลย", () => {
    render(<OrderStatusForm order={makeOrder({ status: "DELIVERED", allowedNextStatuses: [] })} />);

    expect(screen.queryByRole("button", { name: /^บันทึกสถานะ/ })).toBeNull();
    expect(screen.getByText(/เปลี่ยนสถานะต่อจากหน้านี้ไม่ได้แล้ว/)).toBeTruthy();
  });

  it("บันทึกสำเร็จแล้วต้องล้างช่องพัสดุ ไม่ให้เลขเดิมติดไปกับรายการถัดไป", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrderStatus).mockResolvedValue({
      ...makeOrder(),
      status: "SHIPPING",
      allowedNextStatuses: ["SHIPPING", "DELIVERED"],
    });
    render(<OrderStatusForm order={makeOrder()} />);

    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    await user.type(carrierBox(), "Flash Express");
    await user.type(trackingBox(), "TH1234567890");
    await user.click(saveButton());

    expect(await screen.findByText(/อัปเดตเป็น/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "กำลังจัดส่ง" }));
    expect(trackingBox()).toHaveProperty("value", "");
  });
});
