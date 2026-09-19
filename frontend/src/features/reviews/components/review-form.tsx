"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { createReview, updateReview } from "@/services/review.service";
import type { Review } from "@/types/catalog";

const MAX_COMMENT = 2000;
const MIN_COMMENT = 10;

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

  const isEdit = existing !== undefined;
  const tooShort = comment.trim().length < MIN_COMMENT;

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

    try {
      if (isEdit) {
        await updateReview(existing.id, {
          rating,
          title: title.trim() || null,
          comment: comment.trim(),
        });
      } else {
        await createReview({
          productId,
          rating,
          ...(title.trim() ? { title: title.trim() } : {}),
          comment: comment.trim(),
        });
      }

      // ให้ Server Component ดึงข้อมูลใหม่ สถานะ "รอตรวจสอบ" จะได้ตรงกับของจริง
      router.refresh();
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ส่งรีวิวไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setPending(false);
    }
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
          {isEdit ? "บันทึกการแก้ไข" : "ส่งรีวิว"}
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
