import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogManager } from "./catalog-manager.tsx";

import { ApiClientError } from "@/lib/api";
import type { CatalogOverview } from "@/types/admin";

vi.mock("@/services/admin.service", () => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  deleteCatalogItem: vi.fn(),
  reorderCatalog: vi.fn(),
}));

const { createCatalogItem, updateCatalogItem, deleteCatalogItem, reorderCatalog } =
  await import("@/services/admin.service");

const free = { deactivate: null, remove: null, slug: null };

const OVERVIEW: CatalogOverview = {
  categories: [
    {
      id: "tops",
      name: "เสื้อ",
      slug: "tops",
      description: null,
      parentId: null,
      sortOrder: 0,
      isActive: true,
      usage: { products: 3, activeProducts: 2, children: 2, activeChildren: 2, coupons: 0 },
      blockers: {
        deactivate: "มีสินค้าที่เปิดขายอยู่ในหมวดนี้ 2 ชิ้น — ย้ายไปหมวดอื่นหรือปิดการขายก่อน",
        remove: "ยังมีสินค้า 3 ชิ้นในหมวดนี้ (รวมที่ปิดการขายแล้ว) — ย้ายไปหมวดอื่นก่อน",
        slug: "slug อยู่ในลิงก์ของหน้าร้าน — แก้ได้เฉพาะตอนยังไม่มีสินค้าในหมวด",
      },
    },
    {
      id: "tees",
      name: "เสื้อยืด",
      slug: "tees",
      description: null,
      parentId: "tops",
      sortOrder: 0,
      isActive: true,
      usage: { products: 0, activeProducts: 0, children: 0, activeChildren: 0, coupons: 0 },
      blockers: free,
    },
    {
      id: "crops",
      name: "เสื้อครอป",
      slug: "crop-tops",
      description: null,
      parentId: "tops",
      sortOrder: 1,
      isActive: true,
      usage: { products: 0, activeProducts: 0, children: 0, activeChildren: 0, coupons: 0 },
      blockers: free,
    },
  ],
  brands: [],
  sizes: [],
  colors: [],
};

beforeEach(() => {
  for (const fn of [createCatalogItem, updateCatalogItem, deleteCatalogItem, reorderCatalog]) {
    vi.mocked(fn).mockReset();
    vi.mocked(fn).mockResolvedValue(OVERVIEW);
  }
});

describe("CatalogManager — หมวดหมู่และตัวเลือกสินค้า (STEP 48)", () => {
  it("ปุ่มที่ทำไม่ได้ถูกปิดพร้อมเหตุผลจาก server ให้เห็น — ไม่ซ่อนเงียบ ๆ", () => {
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    const deactivate = screen.getByRole("button", { name: /ปิดใช้งาน\s*เสื้อ$/ });
    expect((deactivate as HTMLButtonElement).disabled).toBe(true);
    expect(deactivate.getAttribute("aria-describedby")).not.toBeNull();
    expect(screen.getByText(/ปิดไม่ได้: มีสินค้าที่เปิดขายอยู่ในหมวดนี้ 2 ชิ้น/)).toBeTruthy();

    const remove = screen.getByRole("button", { name: "ลบหมวดหมู่ เสื้อ" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
  });

  it("แก้ชื่อหมวดที่มีสินค้า → ช่อง slug ล็อกพร้อมเหตุผล และส่งไปแค่ชื่อ", async () => {
    const user = userEvent.setup();
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    await user.click(screen.getByRole("button", { name: /แก้ไข\s*เสื้อ$/ }));

    const slugBox = screen.getAllByLabelText(/slug/).at(-1) as HTMLInputElement;
    expect(slugBox.disabled).toBe(true);
    expect(screen.getByText(/แก้ได้เฉพาะตอนยังไม่มีสินค้าในหมวด/)).toBeTruthy();

    const nameBox = screen.getAllByLabelText("ชื่อหมวดหมู่").at(-1)!;
    await user.clear(nameBox);
    await user.type(nameBox, "เสื้อทุกแบบ");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(updateCatalogItem).toHaveBeenCalledWith("categories", "tops", { name: "เสื้อทุกแบบ" });
    expect(await screen.findByText("บันทึกหมวดหมู่แล้ว")).toBeTruthy();
  });

  it("เลื่อนหมวดย่อย → ส่งลำดับพี่น้องทั้งกลุ่มพร้อมหมวดแม่", async () => {
    const user = userEvent.setup();
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    await user.click(screen.getByRole("button", { name: "เลื่อนหมวดหมู่ เสื้อครอป ขึ้น" }));

    expect(reorderCatalog).toHaveBeenCalledWith("categories", ["crops", "tees"], "tops");
  });

  it("เพิ่มหมวดย่อย → ส่งหมวดแม่ที่เลือก · server ปฏิเสธ → แสดงเหตุผลของ server", async () => {
    vi.mocked(createCatalogItem).mockRejectedValueOnce(
      new ApiClientError(409, "หมวดแม่นี้มีหมวดย่อยชื่อนี้อยู่แล้ว", "CONFLICT"),
    );
    const user = userEvent.setup();
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    await user.type(screen.getAllByLabelText("ชื่อหมวดหมู่")[0]!, "เสื้อยืด");
    await user.type(screen.getAllByLabelText(/slug/)[0]!, "tees-2");
    await user.selectOptions(screen.getAllByLabelText("หมวดแม่")[0]!, "tops");
    await user.click(screen.getByRole("button", { name: /^เพิ่มหมวดหมู่$/ }));

    expect(createCatalogItem).toHaveBeenCalledWith("categories", {
      name: "เสื้อยืด",
      slug: "tees-2",
      parentId: "tops",
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ชื่อนี้อยู่แล้ว"));
  });

  it("slug ผิดรูป → ไม่ส่งขึ้น server", async () => {
    const user = userEvent.setup();
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    await user.type(screen.getAllByLabelText("ชื่อหมวดหมู่")[0]!, "กางเกง");
    await user.type(screen.getAllByLabelText(/slug/)[0]!, "กางเกง ยีนส์");
    await user.click(screen.getByRole("button", { name: /^เพิ่มหมวดหมู่$/ }));

    expect(createCatalogItem).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("slug");
  });

  it("ลบต้องกดยืนยันก่อน", async () => {
    const user = userEvent.setup();
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage />);

    await user.click(screen.getByRole("button", { name: "ลบหมวดหมู่ เสื้อยืด" }));
    expect(deleteCatalogItem).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "ยืนยันลบ เสื้อยืด" }));
    expect(deleteCatalogItem).toHaveBeenCalledWith("categories", "tees");
  });

  it("ไม่มีสิทธิ์จัดการ → ดูได้อย่างเดียว ไม่มีปุ่มแก้", () => {
    render(<CatalogManager kind="categories" initial={OVERVIEW} canManage={false} />);

    expect(screen.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
    expect(screen.getByText(/ดูรายการได้อย่างเดียว/)).toBeTruthy();
  });
});
