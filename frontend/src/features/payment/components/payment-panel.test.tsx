import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentPanel } from "./payment-panel.tsx";

import { routerMock } from "../../../../tests/helpers/next-mocks.ts";

import { ApiClientError } from "@/lib/api";
import type { PaymentMethod, PaymentState } from "@/types/catalog";

vi.mock("@/services/payment.service", () => ({
  startPayment: vi.fn(),
  cancelOrder: vi.fn(),
}));

const { startPayment, cancelOrder } = await import("@/services/payment.service");

const COD: PaymentMethod = {
  code: "COD",
  name: "เก็บเงินปลายทาง",
  description: "จ่ายเงินสดตอนรับสินค้า",
  available: true,
  unavailableReason: null,
  online: false,
};

const STRIPE_OFF: PaymentMethod = {
  code: "STRIPE",
  name: "บัตรเครดิต/เดบิต",
  description: "ชำระผ่าน Stripe",
  available: false,
  unavailableReason: "ยังไม่ได้ตั้งค่า STRIPE_SECRET_KEY",
  online: true,
};

function makeState(overrides: Partial<PaymentState> = {}): PaymentState {
  return {
    order: { orderNumber: "TS26090001", total: 1180 },
    methods: [COD, STRIPE_OFF],
    deadline: "2026-09-28T10:00:00.000Z",
    expired: false,
    payable: true,
    attempts: [],
    ...overrides,
  } as PaymentState;
}

beforeEach(() => {
  vi.mocked(startPayment).mockReset();
  vi.mocked(cancelOrder).mockReset();
  vi.mocked(startPayment).mockResolvedValue({ kind: "confirmed" } as never);
  vi.mocked(cancelOrder).mockResolvedValue(undefined as never);
});

/**
 * กฎ STEP 11 ข้อ 1–2: ห้ามมีปุ่มที่ทำให้ออเดอร์กลายเป็น "จ่ายแล้ว" เอง
 * และช่องทางที่ตั้งค่าไม่ครบต้องถูก **ปิด** พร้อมบอกเหตุผลจาก server ตรง ๆ
 */
describe("PaymentPanel — ช่องทางที่ใช้ไม่ได้ต้องปิดจริง (STEP 37)", () => {
  it("ช่องทางที่ server บอกว่าใช้ไม่ได้ ต้องกดเลือกไม่ได้ และบอกเหตุผลของ server", () => {
    render(<PaymentPanel state={makeState()} />);

    const stripe = screen.getByRole<HTMLInputElement>("radio", { name: /บัตรเครดิต/ });

    expect(stripe.disabled).toBe(true);
    expect(screen.getByText("ยังไม่ได้ตั้งค่า STRIPE_SECRET_KEY")).toBeTruthy();
  });

  it("เลือกช่องทางที่ใช้ได้ไว้ให้ตั้งแต่แรก ไม่ใช่ช่องทางที่ปิดอยู่", () => {
    render(<PaymentPanel state={makeState({ methods: [STRIPE_OFF, COD] })} />);

    expect(screen.getByRole<HTMLInputElement>("radio", { name: /เก็บเงินปลายทาง/ }).checked).toBe(
      true,
    );
  });

  it("ไม่มีช่องทางไหนใช้ได้เลย ปุ่มต้องกดไม่ได้ — ห้ามมีทางทำให้จ่ายแล้วเอง", () => {
    render(<PaymentPanel state={makeState({ methods: [STRIPE_OFF] })} />);

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /ไปหน้าชำระเงิน|ยืนยันเก็บเงินปลายทาง/,
      }).disabled,
    ).toBe(true);
  });

  it("COD ต้องเขียนว่าจ่ายตอนรับของ — ห้ามเขียนว่าชำระเงินแล้ว", async () => {
    const user = userEvent.setup();
    render(<PaymentPanel state={makeState()} />);

    const button = screen.getByRole("button", { name: /ยืนยันเก็บเงินปลายทาง/ });

    expect(screen.getAllByText(/จ่ายเงินสด/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ชำระเงินแล้ว/)).toBeNull();

    await user.click(button);

    expect(startPayment).toHaveBeenCalledWith("TS26090001", "COD");
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("ออเดอร์ที่ชำระไปแล้ว/หมดเวลา ต้องไม่มีปุ่มจ่ายเลย", () => {
    render(<PaymentPanel state={makeState({ payable: false })} />);

    expect(screen.queryByRole("button", { name: /ยืนยันเก็บเงินปลายทาง/ })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("server ปฏิเสธ ต้องบอกเหตุผล และไม่แกล้งว่าสำเร็จ", async () => {
    const user = userEvent.setup();
    vi.mocked(startPayment).mockRejectedValue(
      new ApiClientError(409, "คำสั่งซื้อนี้ถูกยกเลิกไปแล้ว", "CONFLICT"),
    );
    render(<PaymentPanel state={makeState()} />);

    await user.click(screen.getByRole("button", { name: /ยืนยันเก็บเงินปลายทาง/ }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "คำสั่งซื้อนี้ถูกยกเลิกไปแล้ว",
    );
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});

describe("PaymentPanel — ยกเลิกคำสั่งซื้อ (STEP 37)", () => {
  it("กดยกเลิกครั้งเดียวยังไม่ยกเลิก ต้องยืนยันอีกชั้น", async () => {
    const user = userEvent.setup();
    render(<PaymentPanel state={makeState()} />);

    await user.click(
      screen.getByRole("button", { name: /ยกเลิกคำสั่งซื้อนี้ \(คืนสินค้าเข้าคลัง\)/ }),
    );

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(screen.getByText("ยกเลิกคำสั่งซื้อนี้?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));

    expect(cancelOrder).toHaveBeenCalledWith("TS26090001");
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('กด "ไม่ยกเลิก" ต้องกลับไปสถานะเดิมโดยไม่ยิงอะไร', async () => {
    const user = userEvent.setup();
    render(<PaymentPanel state={makeState()} />);

    await user.click(
      screen.getByRole("button", { name: /ยกเลิกคำสั่งซื้อนี้ \(คืนสินค้าเข้าคลัง\)/ }),
    );
    await user.click(screen.getByRole("button", { name: "ไม่ยกเลิก" }));

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(screen.queryByText("ยกเลิกคำสั่งซื้อนี้?")).toBeNull();
  });

  it("ปุ่มยกเลิกบอกผลข้างเคียงไว้ในชื่อปุ่ม — คืนสินค้าเข้าคลัง", () => {
    render(<PaymentPanel state={makeState()} />);

    expect(screen.getByRole("button", { name: /คืนสินค้าเข้าคลัง/ })).toBeTruthy();
  });
});
