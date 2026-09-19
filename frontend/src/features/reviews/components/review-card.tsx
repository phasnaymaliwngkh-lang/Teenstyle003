"use client";

import { BadgeCheck, Loader2, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { setReviewHelpful } from "@/services/review.service";
import type { Review } from "@/types/catalog";

import { RatingStars } from "./rating-stars";

const STATUS_NOTE: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "รอร้านตรวจสอบ — คนอื่นยังไม่เห็นรีวิวนี้",
    className: "border-warning/30 bg-warning/5 text-warning",
  },
  HIDDEN: {
    label: "ร้านซ่อนรีวิวนี้จากหน้าสินค้า",
    className: "border-muted-light/40 bg-lilac-50 text-muted",
  },
  REJECTED: {
    label: "ร้านไม่อนุมัติรีวิวนี้",
    className: "border-danger/30 bg-danger/5 text-danger",
  },
};

/**
 * การ์ดรีวิวหนึ่งฉบับ (STEP 23)
 *
 * เป็น client component เพราะปุ่ม "มีประโยชน์" ต้องกดได้โดยไม่โหลดหน้าใหม่
 * ส่วนเนื้อหาทั้งหมดมาจาก backend — ที่นี่ไม่คำนวณอะไรเพิ่ม
 *
 * ⚠️ ยอด "มีประโยชน์" อัปเดตจากค่าที่ server ตอบกลับ ไม่ใช่ `count + 1` ฝั่ง client
 *    เพราะคนอื่นอาจกดพร้อมกัน แล้วเลขที่เห็นจะไม่ตรงกับของจริง
 */
export function ReviewCard({
  review,
  isSignedIn,
  signInHref,
}: {
  review: Review;
  isSignedIn: boolean;
  /** พาไปเข้าสู่ระบบพร้อมกลับมาที่หน้าเดิม — ไม่ทำปุ่มที่กดแล้วเงียบ */
  signInHref: string;
}) {
  const [voted, setVoted] = useState(review.votedHelpful);
  const [count, setCount] = useState(review.helpfulCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusNote = review.isMine ? STATUS_NOTE[review.status] : undefined;

  const handleVote = async () => {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const result = await setReviewHelpful(review.id, !voted);
      setVoted(result.votedHelpful);
      setCount(result.helpfulCount);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setPending(false);
    }
  };

  return (
    <article
      className={cn(
        "rounded-[var(--radius-card)] border bg-white p-5",
        review.isMine ? "border-brand-soft" : "border-line",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-lilac text-sm font-extrabold text-brand-dark"
        >
          {review.author.initial}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold">{review.author.displayName}</span>
            {review.isMine && (
              <span className="rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 text-[11px] font-bold text-brand-dark">
                รีวิวของคุณ
              </span>
            )}
            {review.isVerifiedPurchase && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
                <BadgeCheck className="size-3.5" aria-hidden />
                ซื้อจริงจากร้านนี้
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <RatingStars value={review.rating} size="sm" />
            <time dateTime={review.createdAt} className="text-xs text-muted">
              {new Date(review.createdAt).toLocaleDateString("th-TH", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </div>
        </div>
      </div>

      {statusNote && (
        <p
          className={cn(
            "mt-3 rounded-[var(--radius-card)] border px-3 py-2 text-xs font-semibold",
            statusNote.className,
          )}
        >
          {statusNote.label}
        </p>
      )}

      {review.title !== null && <h4 className="mt-3 text-sm font-extrabold">{review.title}</h4>}

      {/* ข้อความจากลูกค้า — render เป็น text ล้วน ไม่ใช่ HTML เพื่อกัน XSS */}
      <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
        {review.comment}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {review.isMine ? (
          // กดว่ารีวิวของตัวเองมีประโยชน์ไม่ได้ (backend ก็ปฏิเสธ) จึงแสดงเป็นยอดเฉย ๆ
          <p className="text-xs text-muted">
            มีคนว่ารีวิวนี้มีประโยชน์ {count.toLocaleString("th-TH")} คน
          </p>
        ) : isSignedIn ? (
          <button
            type="button"
            onClick={() => void handleVote()}
            disabled={pending}
            aria-pressed={voted}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-semibold transition disabled:opacity-50",
              voted
                ? "border-brand bg-lilac text-brand-dark"
                : "border-line text-muted hover:border-brand-soft hover:bg-lilac-50",
            )}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ThumbsUp className={cn("size-4", voted && "fill-current")} aria-hidden />
            )}
            มีประโยชน์ {count > 0 && `(${count.toLocaleString("th-TH")})`}
          </button>
        ) : (
          <a
            href={signInHref}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-xs font-semibold text-muted transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <ThumbsUp className="size-4" aria-hidden />
            เข้าสู่ระบบเพื่อบอกว่ามีประโยชน์
            {count > 0 && ` (${count.toLocaleString("th-TH")})`}
          </a>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
