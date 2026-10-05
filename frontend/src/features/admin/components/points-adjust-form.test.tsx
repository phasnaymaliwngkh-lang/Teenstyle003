import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PointsAdjustForm } from "./points-adjust-form.tsx";

import { ApiClientError } from "@/lib/api";
import type { AdjustPointsResult } from "@/types/loyalty";

vi.mock("@/services/loyalty.service", () => ({
  adjustCustomerPoints: vi.fn(),
}));

const { adjustCustomerPoints } = await import("@/services/loyalty.service");

const OK: AdjustPointsResult = {
  applied: true,
  standing: {
    points: 150,
    lifetimeSpend: 0,
    tier: { code: "MEMBER", name: "Member", minSpend: 0, earnMultiplierPercent: 100 },
    nextTier: null,
  },
};

const amountBox = () => screen.getByRole("textbox", { name: /จำนวนแต้ม/ });
const reasonBox = () => screen.getByRole("textbox", { name: /เหตุผล/ });

function lastCall() {
  const calls = vi.mocked(adjustCustomerPoints).mock.calls;

  return calls[calls.length - 1]!;
}

describe("PointsAdjustForm — ร้านปรับแต้ม (STEP 42)", () => {
  beforeEach(() => {
    vi.mocked(adjustCustomerPoints).mockReset();
    vi.mocked(adjustCustomerPoints).mockResolvedValue(OK);
  });

  it("เพิ่มแต้มส่ง delta บวก · หักแต้มส่ง delta ลบ — ไม่มีทางส่ง 'ยอดคงเหลือใหม่'", async () => {
    const user = userEvent.setup();
    render(<PointsAdjustForm userId="user-1" balance={300} />);

    await user.type(amountBox(), "50");
    await user.type(reasonBox(), "ชดเชยพัสดุล่าช้า");
    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));

    expect(lastCall()[0]).toBe("user-1");
    expect(lastCall()[1]).toMatchObject({ delta: 50, reason: "ชดเชยพัสดุล่าช้า" });
    expect(lastCall()[1]).not.toHaveProperty("points");

    await user.click(screen.getByRole("radio", { name: "หักแต้ม" }));
    await user.type(amountBox(), "30");
    await user.type(reasonBox(), "แก้แต้มที่ให้เกิน");
    await user.click(screen.getByRole("button", { name: "หักแต้ม" }));

    expect(lastCall()[1]).toMatchObject({ delta: -30 });
  });

  /** Number("5o") = NaN → JSON เป็น null — ต้องตรวจรูปแบบก่อนส่ง (บทเรียน STEP 37) */
  it("จำนวนไม่ใช่จำนวนเต็ม หรือไม่มีเหตุผล → ไม่ยิง API", async () => {
    const user = userEvent.setup();
    render(<PointsAdjustForm userId="user-1" balance={300} />);

    await user.type(amountBox(), "5o");
    await user.type(reasonBox(), "เหตุผลครบ");
    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));

    expect(adjustCustomerPoints).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("จำนวนเต็ม");

    await user.clear(amountBox());
    await user.type(amountBox(), "5");
    await user.clear(reasonBox());
    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));

    expect(adjustCustomerPoints).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("เหตุผล");
  });

  /**
   * กฎ STEP 15 ข้อ 6: กดซ้ำต้องไม่คูณสอง
   *   - ล้มแล้วลองใหม่ = คำขอเดิม → ต้องใช้คีย์เดิม (ถ้าคำขอแรกถึง server แล้ว จะไม่ปรับซ้ำ)
   *   - สำเร็จแล้วกรอกรายการใหม่ = คนละรายการ → ต้องได้คีย์ใหม่
   */
  it("ล้มแล้วลองใหม่ใช้ idempotencyKey เดิม · สำเร็จแล้วรายการถัดไปได้คีย์ใหม่", async () => {
    const user = userEvent.setup();
    vi.mocked(adjustCustomerPoints).mockRejectedValueOnce(
      new ApiClientError(503, "เชื่อมต่อไม่ได้ชั่วคราว", "SERVICE_UNAVAILABLE"),
    );
    render(<PointsAdjustForm userId="user-1" balance={300} />);

    await user.type(amountBox(), "50");
    await user.type(reasonBox(), "ชดเชยพัสดุล่าช้า");
    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));
    const firstKey = lastCall()[1].idempotencyKey;

    expect(screen.getByRole("alert").textContent).toContain("เชื่อมต่อไม่ได้");

    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));
    expect(lastCall()[1].idempotencyKey).toBe(firstKey);
    expect(screen.getByText(/คงเหลือ 150 แต้ม/)).toBeTruthy();

    await user.type(amountBox(), "10");
    await user.type(reasonBox(), "รายการใหม่");
    await user.click(screen.getByRole("button", { name: "เพิ่มแต้ม" }));
    expect(lastCall()[1].idempotencyKey).not.toBe(firstKey);
  });
});
