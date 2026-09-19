import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-6",
} as const;

/**
 * ดาวแบบแสดงผลอย่างเดียว (STEP 23)
 *
 * ⚠️ ไอคอนดาวเป็นภาพล้วน จึงต้อง `aria-hidden` ทุกดวง แล้วบอกคะแนนด้วยข้อความ `sr-only`
 *    ไม่งั้น screen reader จะอ่านว่า "star star star star star" ซึ่งไม่บอกอะไรเลย
 */
export function RatingStars({
  value,
  size = "md",
  className,
  hideLabel = false,
}: {
  value: number;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  /** ซ่อนข้อความ sr-only เมื่อข้อความข้าง ๆ บอกคะแนนอยู่แล้ว (กันอ่านซ้ำ) */
  hideLabel?: boolean;
}) {
  const rounded = Math.round(value);

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {!hideLabel && <span className="sr-only">{value} จาก 5 ดาว</span>}
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            SIZE_CLASS[size],
            star <= rounded ? "fill-warning text-warning" : "text-line",
          )}
        />
      ))}
    </span>
  );
}
