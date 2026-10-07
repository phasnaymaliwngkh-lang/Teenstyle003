import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewForm } from "./review-form.tsx";

import { ApiClientError } from "@/lib/api";
import type { MyReview, Review } from "@/types/catalog";

vi.mock("@/services/review.service", () => ({
  createReview: vi.fn(),
  updateReview: vi.fn(),
  attachReviewImage: vi.fn(),
  removeReviewImage: vi.fn(),
}));

const { createReview, updateReview, attachReviewImage, removeReviewImage } =
  await import("@/services/review.service");

const REVIEW_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const PHOTO_ID = "cccccccc-0000-4000-8000-000000000001";

function reviewWith(images: Review["images"]): MyReview {
  return {
    id: REVIEW_ID,
    rating: 5,
    title: null,
    comment: "ผ้าดีมาก ใส่สบาย ทรงสวยตามรูป",
    images,
    isVerifiedPurchase: true,
    helpfulCount: 0,
    votedHelpful: false,
    isMine: true,
    status: "PENDING",
    author: { displayName: "สมชาย ท.", initial: "ส" },
    createdAt: "2026-10-08T03:00:00.000Z",
    updatedAt: "2026-10-08T03:00:00.000Z",
    product: { id: "product-1", name: "เสื้อทดสอบ", slug: "tee", image: null },
    adminNote: null,
    orderNumber: null,
  };
}

const saved = (images: Review["images"] = []) => ({
  review: reviewWith(images),
  needsApproval: true,
});

const photoUrl = (id: string) => `/media/reviews/2026/10/${id}.webp`;

async function fillReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(/5 ดาว/));
  await user.type(screen.getByLabelText("เล่าให้ฟังหน่อย"), "ผ้าดีมาก ใส่สบาย ทรงสวยตามรูป");
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterAll(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

beforeEach(() => {
  vi.mocked(createReview).mockReset();
  vi.mocked(updateReview).mockReset();
  vi.mocked(attachReviewImage).mockReset();
  vi.mocked(removeReviewImage).mockReset();
});

describe("ReviewForm — แนบรูป (STEP 47)", () => {
  it("เขียนรีวิวใหม่พร้อมรูป → บันทึกข้อความก่อน แล้วแนบรูปกับรีวิวที่ได้ (ส่งแค่ไฟล์ ไม่มี url)", async () => {
    vi.mocked(createReview).mockResolvedValue(saved());
    vi.mocked(attachReviewImage).mockResolvedValue(
      saved([{ id: PHOTO_ID, url: photoUrl(PHOTO_ID) }]),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ReviewForm productId="product-1" onDone={onDone} />);

    await fillReview(user);
    const photo = new File(["jpeg"], "fit.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/เลือกรูป/), photo);
    await user.click(screen.getByRole("button", { name: "ส่งรีวิว" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(createReview).toHaveBeenCalledWith(
      expect.not.objectContaining({ images: expect.anything() }),
    );
    expect(attachReviewImage).toHaveBeenCalledWith(REVIEW_ID, photo);
  });

  it("รูปถูกปฏิเสธ → ฟอร์มไม่ปิด บอกเหตุผล · กดส่งอีกครั้งแก้รีวิวเดิม (ไม่สร้างซ้ำ) และลองแนบเฉพาะรูปที่ค้าง", async () => {
    vi.mocked(createReview).mockResolvedValue(saved());
    vi.mocked(updateReview).mockResolvedValue(saved());
    vi.mocked(attachReviewImage)
      .mockRejectedValueOnce(
        new ApiClientError(503, "ระบบไม่พร้อมให้บริการชั่วคราว", "SERVICE_UNAVAILABLE"),
      )
      .mockResolvedValueOnce(saved([{ id: PHOTO_ID, url: photoUrl(PHOTO_ID) }]));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ReviewForm productId="product-1" onDone={onDone} />);

    await fillReview(user);
    const photo = new File(["jpeg"], "fit.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText(/เลือกรูป/), photo);
    await user.click(screen.getByRole("button", { name: "ส่งรีวิว" }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("alert").some((node) => node.textContent?.includes("บันทึกรีวิวแล้ว")),
      ).toBe(true);
    });
    expect(onDone).not.toHaveBeenCalled();

    // รูปที่ล้มยังค้างอยู่พร้อมเหตุผล — กดส่งอีกครั้งก็ลองแนบใหม่ได้เลย ไม่ต้องเลือกไฟล์ใหม่
    expect(screen.getByRole("button", { name: /เอารูปใหม่ที่ 1/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(updateReview).toHaveBeenCalledWith(REVIEW_ID, expect.any(Object));
    expect(attachReviewImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(attachReviewImage).mock.calls[1]).toEqual([REVIEW_ID, photo]);
  });

  it("ไฟล์ผิดชนิด (HEIC) ไม่ถูกส่ง และบอกเหตุผลตั้งแต่เลือก", async () => {
    vi.mocked(createReview).mockResolvedValue(saved());
    const user = userEvent.setup({ applyAccept: false });
    render(<ReviewForm productId="product-1" />);

    await fillReview(user);
    await user.upload(
      screen.getByLabelText(/เลือกรูป/),
      new File(["heic"], "IMG_0001.HEIC", { type: "image/heic" }),
    );

    expect(screen.getByRole("alert").textContent).toContain("HEIC");

    await user.click(screen.getByRole("button", { name: "ส่งรีวิว" }));
    await waitFor(() => expect(createReview).toHaveBeenCalled());
    expect(attachReviewImage).not.toHaveBeenCalled();
  });

  it("แนบได้ไม่เกิน 4 รูปต่อรีวิว — รวมรูปที่แนบไว้แล้ว", async () => {
    const existing = reviewWith(
      ["1", "2", "3"].map((n) => {
        const id = `cccccccc-0000-4000-8000-00000000000${n}`;
        return { id, url: photoUrl(id) };
      }),
    );
    const user = userEvent.setup();
    render(<ReviewForm productId="product-1" existing={existing} />);

    await user.upload(screen.getByLabelText(/เลือกรูป/), [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);

    expect(screen.getByRole("alert").textContent).toContain("ไม่เกิน 4 รูป");
    expect(screen.getAllByRole("button", { name: /เอารูปใหม่ที่/ })).toHaveLength(1);
    expect((screen.getByLabelText(/แนบครบจำนวนแล้ว/) as HTMLInputElement).disabled).toBe(true);
  });

  it("ลบรูปที่แนบไว้แล้ว → เรียก server ด้วย id ของรูป และใช้รายการรูปที่ server ตอบ", async () => {
    vi.mocked(removeReviewImage).mockResolvedValue(saved([]));
    const existing = reviewWith([{ id: PHOTO_ID, url: photoUrl(PHOTO_ID) }]);
    const user = userEvent.setup();
    render(<ReviewForm productId="product-1" existing={existing} />);

    await user.click(screen.getByRole("button", { name: "ลบรูปที่ 1 ที่แนบไว้แล้ว" }));

    expect(removeReviewImage).toHaveBeenCalledWith(REVIEW_ID, PHOTO_ID);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "ลบรูปที่ 1 ที่แนบไว้แล้ว" })).toBeNull(),
    );
  });
});
