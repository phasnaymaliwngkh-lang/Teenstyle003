import { describe, expect, it } from "vitest";

import {
  catalogRows,
  checkCatalogValues,
  moveWithinGroup,
  toUpdateBody,
  valuesOf,
} from "./catalog-form";

import type { CatalogOverview } from "@/types/admin";

const blockers = { deactivate: null, remove: null, slug: null };
const usage = { products: 0, activeProducts: 0, children: 0, activeChildren: 0, coupons: 0 };

function category(
  id: string,
  parentId: string | null,
  extra: Partial<CatalogOverview["categories"][number]> = {},
) {
  return {
    id,
    name: `หมวด ${id}`,
    slug: `cat-${id}`,
    description: null,
    parentId,
    sortOrder: 0,
    isActive: true,
    usage,
    blockers,
    ...extra,
  };
}

const OVERVIEW: CatalogOverview = {
  categories: [
    category("a", null, { usage: { ...usage, children: 2 } }),
    category("a1", "a"),
    category("a2", "a"),
    category("b", null),
    category("b1", "b"),
  ],
  brands: [],
  sizes: [],
  colors: [
    {
      id: "c1",
      name: "ม่วง",
      slug: "purple",
      hex: "#7C3AED",
      sortOrder: 0,
      isActive: true,
      usage: { variants: 0, sellingVariants: 0 },
      blockers,
    },
  ],
};

describe("catalog-form (STEP 48)", () => {
  it("แก้แค่ชื่อ → ส่งแค่ชื่อ ไม่ส่ง slug เดิมกลับไป (หมวดที่มีสินค้าจะถูกปฏิเสธทั้งที่ไม่ได้แก้ slug)", () => {
    const row = catalogRows(OVERVIEW, "categories")[1]!;
    const body = toUpdateBody("categories", { ...valuesOf(row), name: "ชื่อใหม่" }, row);

    expect(body).toEqual({ name: "ชื่อใหม่" });
  });

  it("ล้างคำอธิบาย = null · ย้ายขึ้นเป็นหมวดบนสุด = parentId null", () => {
    const row = { ...catalogRows(OVERVIEW, "categories")[1]!, description: "เดิม" };
    const body = toUpdateBody(
      "categories",
      { ...valuesOf(row), description: "  ", parentId: "" },
      row,
    );

    expect(body).toEqual({ description: null, parentId: null });
  });

  it("ค่าสีเทียบหลังทำเป็นตัวพิมพ์ใหญ่ — พิมพ์ตัวเล็กค่าเดิมไม่นับว่าแก้", () => {
    const row = catalogRows(OVERVIEW, "colors")[0]!;

    expect(toUpdateBody("colors", { ...valuesOf(row), hex: "#7c3aed" }, row)).toEqual({});
    expect(toUpdateBody("colors", { ...valuesOf(row), hex: "a78bfa" }, row)).toEqual({
      hex: "#A78BFA",
    });
  });

  it("เลื่อนหมวดย่อยสลับได้เฉพาะพี่น้องใต้หมวดแม่เดียวกัน และส่งครบทั้งกลุ่ม", () => {
    const rows = catalogRows(OVERVIEW, "categories");

    expect(moveWithinGroup(rows, "a2", -1)).toEqual(["a2", "a1"]);
    // a2 เป็นตัวสุดท้ายของกลุ่ม a — เลื่อนลงไปปนกับหมวดย่อยของ b ไม่ได้
    expect(moveWithinGroup(rows, "a2", 1)).toBeNull();
    expect(moveWithinGroup(rows, "b", -1)).toEqual(["b", "a"]);
  });

  it("ตรวจรูปแบบก่อนส่ง: slug · รหัสไซซ์ · ค่าสี", () => {
    const empty = { name: "ชื่อ", key: "", description: "", parentId: "", hex: "#000000" };

    expect(checkCatalogValues("categories", { ...empty, key: "Oversize Tee" })).toContain("slug");
    expect(checkCatalogValues("categories", { ...empty, key: "oversize-tee" })).toBeNull();
    expect(checkCatalogValues("sizes", { ...empty, key: "xl" })).toBeNull();
    expect(checkCatalogValues("sizes", { ...empty, key: "X L" })).toContain("รหัสไซซ์");
    expect(checkCatalogValues("colors", { ...empty, key: "navy", hex: "#12" })).toContain(
      "#RRGGBB",
    );
    expect(checkCatalogValues("brands", { ...empty, name: " ", key: "nike" })).toContain("ชื่อ");
  });
});
