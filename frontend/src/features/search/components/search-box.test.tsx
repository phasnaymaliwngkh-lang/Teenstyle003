import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchBox } from "./search-box.tsx";

import { routerMock } from "../../../../tests/helpers/next-mocks.ts";

import type { SearchSuggestions } from "@/types/search";

vi.mock("@/services/search.service", () => ({
  fetchSearchSuggestions: vi.fn(),
}));

const { fetchSearchSuggestions } = await import("@/services/search.service");

function suggestionsFor(query: string): SearchSuggestions {
  return {
    query,
    understood: [{ kind: "color", label: "สีดำ", available: true }],
    products: [
      {
        id: "p1",
        slug: "oversize-tee",
        name: "เสื้อยืด Oversize คอตตอน",
        image: null,
        price: 390,
        finalPrice: 350,
        stockStatus: "IN_STOCK",
      },
    ],
    categories: [{ slug: "tees", name: "เสื้อยืด" }],
  };
}

const box = () => screen.getByRole("combobox", { name: /ค้นหาสินค้า/ });

describe("SearchBox — ช่องค้นหา (STEP 45)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(fetchSearchSuggestions).mockReset();
    vi.mocked(fetchSearchSuggestions).mockImplementation((q) => Promise.resolve(suggestionsFor(q)));
  });

  it("พิมพ์แล้วได้คำแนะนำ · บอกว่าเข้าใจว่าอะไร · ลูกศรลง + Enter เปิดสินค้าที่เลือก", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    await user.type(box(), "เสื้อดำ");

    const product = await screen.findByRole("option", { name: /เสื้อยืด Oversize คอตตอน/ });
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/เข้าใจว่า/).textContent).toContain("สีดำ");
    // พิมพ์ทีละตัวแต่ยิง API เฉพาะคำที่นิ่งแล้ว — ไม่ใช่ทุกตัวอักษร
    expect(vi.mocked(fetchSearchSuggestions).mock.calls.map(([q]) => q)).toEqual(["เสื้อดำ"]);

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(product.id);

    await user.keyboard("{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith("/product/oversize-tee");
  });

  it('กด Enter โดยไม่เลือกคำแนะนำ → ไปหน้าผลค้นหา และจำไว้เป็น "ค้นล่าสุด" ในเครื่องนี้', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SearchBox />);

    await user.type(box(), "กระโปรง ไซซ์ M{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith(
      `/search?q=${encodeURIComponent("กระโปรง ไซซ์ M")}`,
    );
    unmount();

    render(<SearchBox />);
    await user.click(box());

    expect(await screen.findByRole("option", { name: "กระโปรง ไซซ์ M" })).toBeTruthy();
  });

  /** คำตอบของคำก่อนหน้าที่กลับมาช้า ห้ามโผล่ปนกับคำที่พิมพ์อยู่ตอนนี้ */
  it("คำแนะนำของคำเก่าไม่แสดงกับคำใหม่", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSearchSuggestions).mockImplementation(() =>
      Promise.resolve(suggestionsFor("คำอื่นที่ไม่ใช่สิ่งที่พิมพ์")),
    );
    render(<SearchBox />);

    await user.type(box(), "ยีนส์");
    await waitFor(() => expect(fetchSearchSuggestions).toHaveBeenCalled());

    expect(screen.queryByRole("option", { name: /เสื้อยืด Oversize/ })).toBeNull();
    expect(screen.getByRole("option", { name: "ค้นหา “ยีนส์”" })).toBeTruthy();
  });
});
