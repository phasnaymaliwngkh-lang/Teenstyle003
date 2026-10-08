import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StoreSettingsForm } from "./store-settings-form.tsx";

import { ApiClientError } from "@/lib/api";
import type { AdminStoreSettings, StoreSettings } from "@/types/store";

vi.mock("@/services/store.service", () => ({ updateStoreSettings: vi.fn() }));

const { updateStoreSettings } = await import("@/services/store.service");

const SETTINGS: StoreSettings = {
  description: "ร้านแฟชั่นวัยรุ่นสำหรับเทสต์",
  contactEmail: "hello@example.com",
  contactPhone: "02-123-4567",
  instagramUrl: null,
  tiktokUrl: null,
  facebookUrl: null,
  lineUrl: null,
  agentHours: "จันทร์ – เสาร์ 09:00 – 18:00 น.",
  shippingDays: "จันทร์ – เสาร์",
  cutoffTime: "12:00",
  returnWindowDays: 7,
  codMaxTotal: 5000,
};

const DATA: AdminStoreSettings = {
  settings: { ...SETTINGS, updatedAt: "2026-10-08T03:00:00.000Z" },
  limits: {
    returnWindowDays: { min: 1, max: 90 },
    codMaxTotal: { min: 1, max: 100_000 },
    description: { min: 10, max: 600 },
    agentHours: { min: 3, max: 120 },
    shippingDays: { min: 3, max: 60 },
  },
  socialPlatforms: [
    { field: "instagramUrl", label: "Instagram", example: "https://www.instagram.com/ชื่อร้าน" },
    { field: "tiktokUrl", label: "TikTok", example: "https://www.tiktok.com/@ชื่อร้าน" },
    { field: "facebookUrl", label: "Facebook", example: "https://www.facebook.com/ชื่อเพจ" },
    { field: "lineUrl", label: "LINE", example: "https://lin.ee/รหัสบัญชี" },
  ],
};

const saveButton = () => screen.getByRole("button", { name: "บันทึกการตั้งค่าร้าน" });

beforeEach(() => {
  vi.mocked(updateStoreSettings).mockReset();
});

describe("StoreSettingsForm", () => {
  it("แก้เบอร์โทรอย่างเดียว → ส่งแค่ช่องนั้น", async () => {
    vi.mocked(updateStoreSettings).mockResolvedValue({
      ...DATA,
      settings: { ...DATA.settings, contactPhone: "081-111-2222" },
    });
    const user = userEvent.setup();
    render(<StoreSettingsForm data={DATA} />);

    const phone = screen.getByLabelText("เบอร์โทร");
    await user.clear(phone);
    await user.type(phone, "081-111-2222");
    await user.click(saveButton());

    await waitFor(() => expect(updateStoreSettings).toHaveBeenCalledTimes(1));
    expect(updateStoreSettings).toHaveBeenCalledWith({ contactPhone: "081-111-2222" });
    await screen.findByText(/บันทึกแล้ว/);
  });

  it("ลบเบอร์โทรจนว่าง = ร้านไม่มีเบอร์ → ส่ง null", async () => {
    vi.mocked(updateStoreSettings).mockResolvedValue({
      ...DATA,
      settings: { ...DATA.settings, contactPhone: null },
    });
    const user = userEvent.setup();
    render(<StoreSettingsForm data={DATA} />);

    await user.clear(screen.getByLabelText("เบอร์โทร"));
    await user.click(saveButton());

    await waitFor(() => expect(updateStoreSettings).toHaveBeenCalledWith({ contactPhone: null }));
  });

  it("บันทึกแล้วแก้ต่อ → ครั้งที่สองเทียบกับค่าที่ server ตอบ ไม่ส่งช่องเดิมซ้ำ", async () => {
    vi.mocked(updateStoreSettings)
      .mockResolvedValueOnce({ ...DATA, settings: { ...DATA.settings, returnWindowDays: 10 } })
      .mockResolvedValueOnce({
        ...DATA,
        settings: { ...DATA.settings, returnWindowDays: 10, shippingDays: "ทุกวัน" },
      });
    const user = userEvent.setup();
    render(<StoreSettingsForm data={DATA} />);

    const days = screen.getByLabelText("แจ้งคืนสินค้าได้ภายใน (วัน)");
    await user.clear(days);
    await user.type(days, "10");
    await user.click(saveButton());
    await screen.findByText(/บันทึกแล้ว/);

    const shipping = screen.getByLabelText("วันที่ร้านส่งของ");
    await user.clear(shipping);
    await user.type(shipping, "ทุกวัน");
    await user.click(saveButton());

    await waitFor(() => expect(updateStoreSettings).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateStoreSettings).mock.calls[1]![0]).toEqual({ shippingDays: "ทุกวัน" });
  });

  it("ลิงก์โซเชียลที่ server ปฏิเสธ → เห็นเหตุผลของ server ในกล่องแจ้งเตือน", async () => {
    vi.mocked(updateStoreSettings).mockRejectedValue(
      new ApiClientError(422, "ข้อมูลที่ส่งมาไม่ถูกต้อง", "VALIDATION_ERROR", [
        {
          field: "instagramUrl",
          message: "ลิงก์ Instagram ต้องชี้ไปที่โปรไฟล์ของร้าน ไม่ใช่หน้าแรกของ Instagram",
        },
      ]),
    );
    const user = userEvent.setup();
    render(<StoreSettingsForm data={DATA} />);

    await user.type(screen.getByLabelText("Instagram"), "https://instagram.com");
    await user.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toContain("ไม่ใช่หน้าแรกของ Instagram");
  });

  it("ตัวเลขพิมพ์ผิด → ไม่ส่งอะไรขึ้นไป และบอกว่าผิดตรงไหน", async () => {
    const user = userEvent.setup();
    render(<StoreSettingsForm data={DATA} />);

    const cod = screen.getByLabelText("ยอดสูงสุดที่รับเก็บเงินปลายทาง (บาท)");
    await user.clear(cod);
    await user.type(cod, "ห้าพัน");
    await user.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toContain("COD");
    expect(updateStoreSettings).not.toHaveBeenCalled();
  });
});
