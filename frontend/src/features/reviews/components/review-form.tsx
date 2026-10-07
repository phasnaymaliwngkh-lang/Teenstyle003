"use client";

import { Camera, Loader2, Star, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { megabytes, precheckImageFile, REVIEW_PHOTO_RULES } from "@/lib/image-upload";
import { cn } from "@/lib/utils";
import {
  attachReviewImage,
  createReview,
  removeReviewImage,
  updateReview,
} from "@/services/review.service";
import type { Review, ReviewImage } from "@/types/catalog";

const MAX_COMMENT = 2000;
const MIN_COMMENT = 10;

/** รูปที่เลือกไว้แต่ยังไม่ได้แนบ (STEP 47) */
interface PendingPhoto {
  key: string;
  file: File;
  previewUrl: string;
  /** ตรวจไม่ผ่านตั้งแต่ในเบราว์เซอร์ หรือ server ปฏิเสธ */
  error: string | null;
}

const RATING_LABEL: Record<number, string> = {
  1: "ไม่ดีเลย",
  2: "พอใช้",
  3: "ปานกลาง",
  4: "ดี",
  5: "ดีมาก",
};

/**
 * ฟอร์มเขียน/แก้รีวิว (STEP 23)
 *
 * ⚠️ **ดาวทำด้วย `<input type="radio">` จริง ไม่ใช่ปุ่มที่ดูเหมือนดาว**
 *    เพื่อให้เลื่อนด้วยลูกศรได้ตามปกติ และ screen reader อ่านว่าเป็นตัวเลือกกี่จากกี่
 *    (ปุ่มไอคอนเปล่า ๆ ใช้คีย์บอร์ดให้คะแนนได้ยากมาก)
 *
 * ⚠️ ฟอร์มนี้ไม่ทำเป็นหน้าต่าง modal โดยเจตนา — ผู้ใช้พิมพ์ข้อความยาว
 *    เผลอคลิกพื้นหลังแล้วงานหายคือความเสียหายที่ไม่คุ้มกับความสวย
 *    (กฎ accessibility ของโปรเจกต์: ฟอร์มยาวห้ามปิดด้วยการคลิกพื้นหลัง)
 */
export function ReviewForm({
  productId,
  existing,
  onDone,
  onCancel,
}: {
  productId: string;
  /** มีค่า = โหมดแก้ไขรีวิวเดิม */
  existing?: Review;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const fieldId = useId();

  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** รีวิวที่บันทึกแล้ว — รีวิวใหม่ที่รูปบางรูปแนบไม่สำเร็จ กดส่งอีกครั้งต้องไม่สร้างรีวิวซ้ำ */
  const [savedReviewId, setSavedReviewId] = useState<string | null>(existing?.id ?? null);
  const [savedImages, setSavedImages] = useState<ReviewImage[]>(existing?.images ?? []);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // คืนหน่วยความจำของภาพตัวอย่างตอนปิดฟอร์ม — เขียน ref ใน effect ไม่ใช่ระหว่าง render
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const isEdit = existing !== undefined;
  const tooShort = comment.trim().length < MIN_COMMENT;
  const photoSlots = REVIEW_PHOTO_RULES.maxPhotos - savedImages.length - photos.length;

  function onPickPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;

    const accepted = files.slice(0, Math.max(0, photoSlots));
    setError(
      accepted.length < files.length
        ? `แนบรูปได้ไม่เกิน ${REVIEW_PHOTO_RULES.maxPhotos} รูปต่อรีวิว`
        : null,
    );

    setPhotos([
      ...photos,
      ...accepted.map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${photos.length + index}`,
        file,
        previewUrl: URL.createObjectURL(file),
        error: precheckImageFile(file, REVIEW_PHOTO_RULES),
      })),
    ]);
  }

  function dropPhoto(key: string) {
    const photo = photos.find((entry) => entry.key === key);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhotos(photos.filter((entry) => entry.key !== key));
  }

  /** ลบรูปที่แนบไว้แล้ว — มีผลทันที และรีวิวกลับไปรอร้านตรวจ (server เป็นคนตัดสิน) */
  async function removeSaved(image: ReviewImage) {
    if (savedReviewId === null || image.id === null) return;

    setRemovingId(image.id);
    setError(null);

    try {
      const result = await removeReviewImage(savedReviewId, image.id);
      setSavedImages(result.review.images);
      router.refresh();
    } catch (err) {
      setError(describeApiError(err, "ลบรูปไม่สำเร็จ กรุณาลองใหม่"));
    } finally {
      setRemovingId(null);
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (rating === 0) {
      setError("กรุณาให้คะแนนดาวก่อนส่งรีวิว");
      return;
    }

    if (tooShort) {
      setError(`เขียนรีวิวอย่างน้อย ${MIN_COMMENT} ตัวอักษร เพื่อให้คนอื่นได้ประโยชน์จริง`);
      return;
    }

    setPending(true);
    setError(null);

    let reviewId = savedReviewId;

    try {
      if (reviewId !== null) {
        await updateReview(reviewId, {
          rating,
          title: title.trim() || null,
          comment: comment.trim(),
        });
      } else {
        const created = await createReview({
          productId,
          rating,
          ...(title.trim() ? { title: title.trim() } : {}),
          comment: comment.trim(),
        });
        reviewId = created.review.id;
        setSavedReviewId(reviewId);
      }
    } catch (err) {
      setError(describeApiError(err, "ส่งรีวิวไม่สำเร็จ กรุณาลองใหม่"));
      setPending(false);
      return;
    }

    // ข้อความบันทึกแล้ว — แนบรูปทีละรูป รูปที่ไม่ผ่านค้างไว้พร้อมเหตุผลให้ลองใหม่หรือเอาออก
    let failed = 0;
    let remaining = photos;

    for (const photo of photos) {
      // ข้ามเฉพาะไฟล์ที่ผิดตั้งแต่ในเบราว์เซอร์ — ไฟล์ที่ server เคยปฏิเสธ (เช่นระบบล่มชั่วคราว)
      // ลองใหม่ได้ด้วยการกดส่งอีกครั้ง ไม่ต้องเอาออกแล้วเลือกใหม่
      if (precheckImageFile(photo.file, REVIEW_PHOTO_RULES) !== null) {
        failed += 1;
        continue;
      }

      try {
        const result = await attachReviewImage(reviewId, photo.file);
        setSavedImages(result.review.images);
        URL.revokeObjectURL(photo.previewUrl);
        remaining = remaining.filter((entry) => entry.key !== photo.key);
      } catch (err) {
        failed += 1;
        remaining = remaining.map((entry) =>
          entry.key === photo.key
            ? { ...entry, error: describeApiError(err, "แนบรูปนี้ไม่สำเร็จ") }
            : entry,
        );
      }
    }

    setPhotos(remaining);
    setPending(false);

    // ให้ Server Component ดึงข้อมูลใหม่ สถานะ "รอตรวจสอบ" จะได้ตรงกับของจริง
    router.refresh();

    if (failed > 0) {
      setError(
        `บันทึกรีวิวแล้ว แต่แนบรูปไม่สำเร็จ ${failed} รูป — เอารูปนั้นออก หรือแก้แล้วกดส่งอีกครั้ง`,
      );
      return;
    }

    onDone?.();
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-4 rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      <fieldset>
        <legend className="text-sm font-bold">ให้คะแนนสินค้านี้</legend>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <label
                key={star}
                className="cursor-pointer rounded-[var(--radius-pill)] p-1 transition focus-within:ring-2 focus-within:ring-brand hover:bg-lilac-50"
              >
                <input
                  type="radio"
                  name={`${fieldId}-rating`}
                  value={star}
                  checked={rating === star}
                  onChange={() => setRating(star)}
                  className="sr-only"
                />
                <span className="sr-only">
                  {star} ดาว — {RATING_LABEL[star]}
                </span>
                <Star
                  aria-hidden
                  className={cn(
                    "size-8",
                    star <= rating ? "fill-warning text-warning" : "text-line",
                  )}
                />
              </label>
            ))}
          </div>

          {/* ประกาศคะแนนที่เลือกให้ screen reader รู้โดยไม่ต้องย้าย focus */}
          <p aria-live="polite" className="text-sm font-semibold text-muted">
            {rating === 0 ? "ยังไม่ได้ให้คะแนน" : `${rating} ดาว — ${RATING_LABEL[rating]}`}
          </p>
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${fieldId}-title`} className="text-sm font-bold">
          หัวข้อ <span className="font-normal text-muted">(ไม่บังคับ)</span>
        </label>
        <input
          id={`${fieldId}-title`}
          type="text"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="สรุปสั้น ๆ เช่น ผ้าดี ใส่สบาย"
          className="mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-comment`} className="text-sm font-bold">
          เล่าให้ฟังหน่อย
        </label>
        <textarea
          id={`${fieldId}-comment`}
          value={comment}
          rows={5}
          maxLength={MAX_COMMENT}
          onChange={(event) => setComment(event.target.value)}
          aria-describedby={`${fieldId}-hint`}
          placeholder="ไซซ์ตรงไหม เนื้อผ้าเป็นอย่างไร ใส่แล้วรู้สึกอย่างไร — สิ่งที่คุณอยากรู้ก่อนซื้อนั่นแหละ"
          className="mt-1 w-full rounded-[var(--radius-card)] border border-line p-3 text-sm leading-relaxed outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
        />
        <p id={`${fieldId}-hint`} className="mt-1 text-xs text-muted">
          {comment.trim().length.toLocaleString("th-TH")} / {MAX_COMMENT.toLocaleString("th-TH")}{" "}
          ตัวอักษร · อย่างน้อย {MIN_COMMENT} ตัวอักษร
        </p>
      </div>

      {/* ─── รูปประกอบ (STEP 47) ─── */}
      <fieldset>
        <legend className="text-sm font-bold">
          รูปประกอบ <span className="font-normal text-muted">(ไม่บังคับ)</span>
        </legend>
        <p className="mt-1 text-xs text-muted">
          แนบได้สูงสุด {REVIEW_PHOTO_RULES.maxPhotos} รูป · {REVIEW_PHOTO_RULES.acceptedText}{" "}
          ไม่เกิน {megabytes(REVIEW_PHOTO_RULES.maxBytes)} · ร้านลบข้อมูลที่ติดมากับรูป (ตำแหน่ง GPS
          รุ่นกล้อง) ให้ก่อนเก็บ · รูปขึ้นหน้าสินค้าหลังร้านตรวจพร้อมรีวิว
        </p>

        {(savedImages.length > 0 || photos.length > 0) && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {savedImages.map((image, index) => (
              <li key={image.url} className="relative size-20">
                <span className="relative block size-20 overflow-hidden rounded-[12px] border border-line bg-lilac-50">
                  <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
                </span>
                {image.id !== null && (
                  <button
                    type="button"
                    onClick={() => void removeSaved(image)}
                    disabled={pending || removingId !== null}
                    aria-label={`ลบรูปที่ ${index + 1} ที่แนบไว้แล้ว`}
                    className="absolute -top-2 -right-2 grid size-11 place-items-center rounded-full border border-line bg-white shadow-[var(--shadow-soft)] transition hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    {removingId === image.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <X className="size-4" aria-hidden />
                    )}
                  </button>
                )}
              </li>
            ))}

            {photos.map((photo, index) => (
              <li key={photo.key} className="relative w-20">
                <span
                  className={cn(
                    "relative block size-20 overflow-hidden rounded-[12px] border bg-lilac-50",
                    photo.error !== null ? "border-danger" : "border-dashed border-brand-soft",
                  )}
                >
                  <Image src={photo.previewUrl} alt="" fill sizes="80px" className="object-cover" />
                </span>
                <button
                  type="button"
                  onClick={() => dropPhoto(photo.key)}
                  disabled={pending}
                  aria-label={`เอารูปใหม่ที่ ${index + 1} (${photo.file.name}) ออก`}
                  className="absolute -top-2 -right-2 grid size-11 place-items-center rounded-full border border-line bg-white shadow-[var(--shadow-soft)] transition hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden />
                </button>
                {photo.error !== null && (
                  <p
                    role="alert"
                    className="mt-1 text-[11px] leading-tight font-semibold text-danger"
                  >
                    {photo.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <label
          className={cn(
            "mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-brand hover:border-brand-soft hover:bg-lilac-50",
            (photoSlots <= 0 || pending) && "pointer-events-none opacity-50",
          )}
        >
          <Camera className="size-4" aria-hidden />
          {photoSlots <= 0 ? "แนบครบจำนวนแล้ว" : "เลือกรูป"}
          <input
            type="file"
            accept={REVIEW_PHOTO_RULES.acceptedTypes.join(",")}
            multiple
            onChange={onPickPhotos}
            disabled={photoSlots <= 0 || pending}
            className="sr-only"
          />
        </label>
      </fieldset>

      <p className="rounded-[var(--radius-card)] border border-line bg-lilac-50 px-3 py-2 text-xs text-muted">
        รีวิวจะขึ้นหน้าสินค้าหลังร้านตรวจสอบแล้ว ·
        ชื่อที่แสดงจะถูกย่อเหลือชื่อต้นกับอักษรแรกของนามสกุล เช่น &ldquo;สมชาย ก.&rdquo; —
        ร้านไม่เปิดเผยชื่อเต็มหรืออีเมลของคุณ
      </p>

      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition disabled:opacity-50"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isEdit || savedReviewId !== null ? "บันทึกการแก้ไข" : "ส่งรีวิว"}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
          >
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}
