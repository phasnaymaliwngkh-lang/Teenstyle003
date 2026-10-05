import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PointsRedeemer } from "./points-redeemer.tsx";

import type { CheckoutSummary } from "@/types/catalog";
import type { CheckoutLoyalty } from "@/types/loyalty";

vi.mock("@/services/order.service", () => ({
  fetchCheckoutSummary: vi.fn(),
}));

const { fetchCheckoutSummary } = await import("@/services/order.service");

const RULES: CheckoutLoyalty["rules"] = {
  earnBahtPerPoint: 10,
  redeemPointsPerBaht: 10,
  redeemStepPoints: 10,
  redeemMinimumPoints: 100,
  redeemMaxPercentOfSubtotal: 50,
  tiers: [],
};

function makeLoyalty(overrides: Partial<CheckoutLoyalty> = {}): CheckoutLoyalty {
  return {
    balance: 500,
    tier: { code: "MEMBER", name: "Member", minSpend: 0, earnMultiplierPercent: 100 },
    maxRedeemablePoints: 300,
    appliedPoints: 0,
    pointsDiscount: 0,
    error: null,
    rules: RULES,
    ...overrides,
  };
}

/** server ตอบสรุปยอด — เทสต์สนใจแค่ส่วน loyalty */
function serverReplies(loyalty: Partial<CheckoutLoyalty>) {
  vi.mocked(fetchCheckoutSummary).mockResolvedValueOnce({
    loyalty: makeLoyalty(loyalty),
  } as CheckoutSummary);
}

const pointsBox = () => screen.getByRole("textbox", { name: /จำนวนแต้มที่จะใช้/ });
const applyButton = () => screen.getByRole("button", { name: "ใช้แต้ม" });

describe("PointsRedeemer — ใช้แต้มตอน checkout (STEP 42)", () => {
  beforeEach(() => {
    vi.mocked(fetchCheckoutSummary).mockReset();
  });

  it("แต้มไม่ถึงขั้นต่ำ: ไม่มีช่องกรอก และบอกว่าต้องสะสมถึงเท่าไร", () => {
    render(
      <PointsRedeemer
        loyalty={makeLoyalty({ balance: 40 })}
        shippingMethod="STANDARD"
        couponCode={null}
        applied={null}
        onApplied={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/สะสมครบ 100 แต้ม/)).toBeTruthy();
  });

  /**
   * หน้าเว็บต้องไม่คิดส่วนลดจากแต้มเอง — ส่วนลดที่ใช้ต้องเป็นตัวเลขที่ server ตอบ
   * และต้องถามด้วยคูปอง + วิธีจัดส่งชุดเดียวกับที่จะสั่งจริง (เพดานแต้มขึ้นกับคูปอง)
   */
  it("กดใช้แต้ม → ถาม server ด้วยคูปองและวิธีจัดส่งชุดเดียวกับที่จะสั่ง แล้วใช้ตัวเลขที่ server ตอบ", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    serverReplies({ appliedPoints: 200, pointsDiscount: 20 });

    render(
      <PointsRedeemer
        loyalty={makeLoyalty()}
        shippingMethod="EXPRESS"
        couponCode="TEEN15"
        applied={null}
        onApplied={onApplied}
      />,
    );

    await user.type(pointsBox(), "200");
    await user.click(applyButton());

    expect(fetchCheckoutSummary).toHaveBeenCalledWith("EXPRESS", "TEEN15", 200);
    expect(onApplied).toHaveBeenLastCalledWith({ points: 200, discount: 20 });
  });

  it("server ปฏิเสธ → แสดงเหตุผลเป็น alert และไม่ใช้แต้ม (ไม่ลดให้เงียบ ๆ)", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    serverReplies({ error: "แต้มไม่พอ — คุณมี 500 แต้ม", appliedPoints: 0 });

    render(
      <PointsRedeemer
        loyalty={makeLoyalty()}
        shippingMethod="STANDARD"
        couponCode={null}
        applied={null}
        onApplied={onApplied}
      />,
    );

    await user.type(pointsBox(), "900");
    await user.click(applyButton());

    expect(onApplied).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toContain("แต้มไม่พอ");
  });

  /** Number("12a") = NaN → JSON เป็น null — ต้องตรวจรูปแบบก่อนส่ง (บทเรียน STEP 37) */
  it("พิมพ์ไม่ใช่จำนวนเต็ม → ไม่ยิง API และบอกให้แก้", async () => {
    const user = userEvent.setup();

    render(
      <PointsRedeemer
        loyalty={makeLoyalty()}
        shippingMethod="STANDARD"
        couponCode={null}
        applied={null}
        onApplied={vi.fn()}
      />,
    );

    await user.type(pointsBox(), "12a");
    await user.click(applyButton());

    expect(fetchCheckoutSummary).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("จำนวนเต็ม");
  });

  it('"ไม่ใช้แต้ม" ล้างค่าที่ใช้ไว้', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();

    render(
      <PointsRedeemer
        loyalty={makeLoyalty()}
        shippingMethod="STANDARD"
        couponCode={null}
        applied={{ points: 200, discount: 20 }}
        onApplied={onApplied}
      />,
    );

    expect(screen.getByText(/ใช้ 200 แต้ม — ลด/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ไม่ใช้แต้ม" }));

    expect(onApplied).toHaveBeenLastCalledWith(null);
  });
});
