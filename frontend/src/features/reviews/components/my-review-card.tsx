"use client";

import { Loader2, PenLine, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { deleteReview } from "@/services/review.service";
import type { MyReview, ReviewStatus } from "@/types/catalog";

import { RatingStars } from "./rating-stars";
import { ReviewForm } from "./review-form";

const STATUS: Record<ReviewStatus, { label: string; className: string; hint: string }> = {
  PENDING: {
    label: "รอตรวจสอบ",
    className: "border-warning/30 bg-warning/5 text-warning",
    hint: "ร้านกำลังตรวจ — ยังไม่แสดงบนหน้าสินค้า",
  },
  APPROVED: {
    label: "แสดงอยู่",
    className: "border-success/30 bg-success/5 text-success",
    hint: "รีวิวนี้แสดงอยู่บนหน้าสินค้าแล้ว",
  },
  HIDDEN: {
    label: "ถูกซ่อน",
    className: "border-muted-light/40 bg-lilac-50 text-muted",
    hint: "ร้านซ่อนรีวิวนี้จากหน้าสินค้า",
  },
  REJECTED: {
    label: "ไม่อนุมัติ",
    className: "border-danger/30 bg-danger/5 text-danger",
    hint: "ร้านไม่อนุมัติรีวิวนี้ — แก้ไขแล้วส่งตรวจใหม่ได้",
  },
};

/**
 * รีวิวหนึ่งฉบับในหน้า "รีวิวของฉัน" (STEP 23)
 *
 * ⚠️ ปุ่มลบใช้การยืนยันสองจังหวะในที่เดียวกัน ไม่ใช่หน้าต่าง modal
 *    เพราะกล่องยืนยันที่ทำไม่ครบตามแพตเทิร์น dialog (Esc · focus · ล็อก scroll)
 *    จะใช้งานด้วยคีย์บอร์ดไม่ได้จริง — สองจังหวะในที่เดียวปลอดภัยกว่าและเข้าถึงได้เต็มที่
 */
export function MyReviewCard({ review }: { review: MyReview }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS[review.status];

  const handleDelete = async () => {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      await deleteReview(review.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ลบรีวิวไม่สำเร็จ กรุณาลองใหม่");
      setPending(false);
      setConfirming(false);
    }
  };

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <div className="flex gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-lilac-50">
          {review.product.image ? (
            <Image
              src={review.product.image.url}
              alt={review.product.image.alt}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center text-2xl" aria-hidden>
              ✧
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">
            {review.product.slug !== null ? (
              <Link
                href={`/product/${review.product.slug}#reviews`}
                className="transition hover:text-brand"
              >
                {review.product.name}
              </Link>
            ) : (
              <>
                {review.product.name}{" "}
                <span className="font-normal text-muted">(ไม่ได้เปิดขายแล้ว)</span>
              </>
            )}
          </h3>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <RatingStars value={review.rating} size="sm" />
            <span
              className={cn(
                "rounded-[var(--radius-pill)] border px-2 py-0.5 text-[11px] font-bold",
                status.className,
              )}
            >
              {status.label}
            </span>
            <time dateTime={review.createdAt} className="text-xs text-muted">
              {new Date(review.createdAt).toLocaleDateString("th-TH", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </div>

          <p className="mt-1 text-xs text-muted">{status.hint}</p>
          {review.orderNumber !== null && (
            <p className="mt-0.5 text-xs text-muted">จากคำสั่งซื้อ {review.orderNumber}</p>
          )}
        </div>
      </div>

      {review.adminNote !== null && (
        <p className="mt-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-3 py-2 text-xs text-ink-soft">
          <span className="font-bold">หมายเหตุจากร้าน:</span> {review.adminNote}
        </p>
      )}

      {editing ? (
        <div className="mt-4">
          <ReviewForm
            productId={review.product.id}
            existing={review}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <>
          {review.title !== null && <h4 className="mt-3 text-sm font-extrabold">{review.title}</h4>}
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
            {review.comment}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
            >
              <PenLine className="size-4" aria-hidden />
              แก้ไข
            </button>

            {confirming ? (
              <>
                <span role="alert" className="text-xs font-semibold text-danger">
                  ลบรีวิวนี้จริงไหม
                </span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={pending}
                  className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger bg-danger px-4 text-xs font-bold text-white transition disabled:opacity-50"
                >
                  {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  ยืนยันลบ
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-xs font-semibold transition hover:bg-lilac-50 disabled:opacity-50"
                >
                  ไม่ลบ
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-xs font-semibold text-muted transition hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
              >
                <Trash2 className="size-4" aria-hidden />
                ลบรีวิว
              </button>
            )}
          </div>
        </>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
