"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * แกลเลอรีรูปสินค้า (STEP 6)
 *
 * เป็น client component เพราะต้องสลับรูปตอนคลิก thumbnail
 * ถ้ามีรูปเดียวก็ไม่แสดงแถว thumbnail
 */
export function ProductGallery({
  images,
  productName,
}: {
  images: { url: string; alt: string; isMain: boolean }[];
  productName: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex];

  if (!active) {
    return (
      <div className="grid aspect-4/5 w-full place-items-center rounded-[var(--radius-card)] bg-lilac-50 text-5xl">
        <span aria-hidden>✧</span>
        <span className="sr-only">ไม่มีรูปสินค้า</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-4/5 w-full overflow-hidden rounded-[var(--radius-card)] bg-lilac-50">
        <Image
          src={active.url}
          alt={active.alt || productName}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 560px"
          className="object-cover"
        />
      </div>

      {images.length > 1 && (
        <div role="group" aria-label="รูปสินค้าอื่น" className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-pressed={index === activeIndex}
              aria-label={`ดูรูปที่ ${index + 1}: ${image.alt || productName}`}
              className={cn(
                "relative size-20 overflow-hidden rounded-[12px] border-2 transition",
                index === activeIndex ? "border-brand" : "border-line hover:border-brand-soft",
              )}
            >
              <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
