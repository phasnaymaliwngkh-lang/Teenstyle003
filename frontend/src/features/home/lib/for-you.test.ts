import { describe, expect, it } from "vitest";

import type { ForYouResult } from "@/types/recommendation";

import { forYouHeading } from "./for-you";

const popular = (fallbackReason: ForYouResult["fallbackReason"]): ForYouResult => ({
  mode: "POPULAR",
  fallbackReason,
  items: [],
});

describe("หัวข้อของส่วนแนะนำบนหน้าแรก (STEP 46)", () => {
  it("มีประวัติ → แนะนำสำหรับคุณ และแสดงเหตุผลใต้การ์ด", () => {
    const heading = forYouHeading({ mode: "PERSONAL", fallbackReason: null, items: [] });

    expect(heading.title).toBe("แนะนำสำหรับคุณ");
    expect(heading.showReasons).toBe(true);
    expect(heading.showOptInLink).toBe(false);
  });

  it.each(["GUEST", "NO_HISTORY", "NO_MATCH", "OPTED_OUT"] as const)(
    "โหมดยอดนิยม (%s) ห้ามเรียกตัวเองว่า สำหรับคุณ",
    (reason) => {
      const heading = forYouHeading(popular(reason));

      expect(heading.title).not.toContain("สำหรับคุณ");
      expect(heading.title).toBe("ยอดนิยมในร้าน");
      expect(heading.showReasons).toBe(false);
    },
  );

  it("คนที่ปิดการแนะนำ → บอกว่าไม่ได้อ่านประวัติ และมีทางไปเปิดสวิตช์", () => {
    const heading = forYouHeading(popular("OPTED_OUT"));

    expect(heading.subtitle).toContain("ไม่อ่านประวัติของคุณ");
    expect(heading.showOptInLink).toBe(true);
    expect(forYouHeading(popular("GUEST")).showOptInLink).toBe(false);
  });
});
