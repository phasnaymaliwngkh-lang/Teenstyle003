import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RefundForm } from "./refund-form.tsx";

import { ApiClientError } from "@/lib/api";
import type { RecordRefundInput } from "@/types/returns";

const METHODS = [
  { code: "BANK_TRANSFER" as const, label: "โอนเงินคืนเข้าบัญชีลูกค้า" },
  { code: "STRIPE_DASHBOARD" as const, label: "คืนผ่าน Stripe Dashboard" },
];

const referenceBox = () => screen.getByRole("textbox", { name: /เลขอ้างอิง/ });
const saveButton = () => screen.getByRole("button", { name: "บันทึกว่าคืนเงินแล้ว" });

describe("RefundForm — บันทึกการคืนเงิน (STEP 43)", () => {
  it("บอกตรง ๆ ว่าระบบไม่ได้โอนเงินเอง และไม่มีช่องกรอกยอดเงิน", () => {
    render(<RefundForm amount={281} methods={METHODS} submit={vi.fn()} />);

    expect(screen.getByText(/ไม่ได้โอนเงินให้/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /ยอด|จำนวนเงิน/ })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("ไม่มีเลขอ้างอิง → ไม่ส่ง · ส่งได้แค่วิธี + เลขอ้างอิง (ไม่มียอดเงิน)", async () => {
    const user = userEvent.setup();
    const submit = vi.fn<(input: RecordRefundInput) => Promise<{ applied: boolean }>>(() =>
      Promise.resolve({ applied: true }),
    );
    render(<RefundForm amount={281} methods={METHODS} submit={submit} />);

    await user.click(saveButton());
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("เลขอ้างอิง");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "วิธีที่คืนเงิน" }),
      "STRIPE_DASHBOARD",
    );
    await user.type(referenceBox(), "re_3Pq9xyz");
    await user.click(saveButton());

    const input = submit.mock.calls[0]![0];
    expect(input).toMatchObject({ method: "STRIPE_DASHBOARD", reference: "re_3Pq9xyz" });
    expect(input).not.toHaveProperty("amount");
  });

  /** กดซ้ำต้องไม่บันทึกเงินออกสองครั้ง (กฎเดียวกับการปรับสต็อกของ STEP 15 ข้อ 6) */
  it("ล้มแล้วลองใหม่ใช้ idempotencyKey เดิม · สำเร็จแล้วรายการถัดไปได้คีย์ใหม่", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn<(input: RecordRefundInput) => Promise<{ applied: boolean }>>()
      .mockRejectedValueOnce(
        new ApiClientError(503, "เชื่อมต่อไม่ได้ชั่วคราว", "SERVICE_UNAVAILABLE"),
      )
      .mockResolvedValue({ applied: true });
    render(<RefundForm amount={281} methods={METHODS} submit={submit} />);

    await user.type(referenceBox(), "TRF-0001");
    await user.click(saveButton());
    const firstKey = submit.mock.calls[0]![0].idempotencyKey;

    await user.click(saveButton());
    expect(submit.mock.calls[1]![0].idempotencyKey).toBe(firstKey);

    await user.type(referenceBox(), "TRF-0002");
    await user.click(saveButton());
    expect(submit.mock.calls[2]![0].idempotencyKey).not.toBe(firstKey);
  });
});
