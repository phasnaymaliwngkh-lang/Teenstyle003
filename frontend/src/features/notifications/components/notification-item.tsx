"use client";

import {
  BadgeCheck,
  Bell,
  CircleX,
  Loader2,
  Package,
  Star,
  Tag,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { markNotificationRead } from "@/services/notification.service";
import type { AppNotification, NotificationType } from "@/types/catalog";

/** ไอคอนและสีของแต่ละเหตุการณ์ — ช่วยกวาดตาหาเรื่องที่สนใจได้เร็ว */
const LOOK: Record<NotificationType, { icon: typeof Bell; tone: string }> = {
  ORDER_CREATED: { icon: Package, tone: "text-brand" },
  ORDER_UPDATE: { icon: Package, tone: "text-brand" },
  ORDER_CANCELLED: { icon: CircleX, tone: "text-danger" },
  PAYMENT_SUCCESS: { icon: BadgeCheck, tone: "text-success" },
  PAYMENT_FAILED: { icon: Wallet, tone: "text-danger" },
  SHIPPING: { icon: Truck, tone: "text-brand" },
  DELIVERED: { icon: BadgeCheck, tone: "text-success" },
  PRICE_DROP: { icon: Tag, tone: "text-success" },
  WISHLIST_UPDATE: { icon: Tag, tone: "text-brand" },
  PROMOTION: { icon: Tag, tone: "text-brand" },
  REVIEW_UPDATE: { icon: Star, tone: "text-warning" },
  LOW_STOCK: { icon: Bell, tone: "text-warning" },
  SYSTEM: { icon: Bell, tone: "text-muted" },
};

/**
 * การแจ้งเตือนหนึ่งรายการ (STEP 24)
 *
 * เป็น client component เพราะการกดต้องทำเครื่องหมายว่าอ่านแล้วโดยไม่ต้องโหลดหน้าใหม่
 *
 * ⚠️ ลิงก์มาจาก backend (`link`) ไม่ใช่เดาจาก type ที่ฝั่งนี้
 *    `link = null` = ไม่มีหน้าให้ไป → แสดงเป็นการ์ดเฉย ๆ **ห้ามทำลิงก์ที่พาไป 404**
 */
export function NotificationItem({ notification }: { notification: AppNotification }) {
  const router = useRouter();
  const [isRead, setIsRead] = useState(notification.isRead);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look = LOOK[notification.type] ?? LOOK.SYSTEM;
  const Icon = look.icon;

  const markRead = async () => {
    if (isRead || pending) return;
    setPending(true);
    setError(null);
    setIsRead(true); // optimistic — ตัวเลขบนกระดิ่งจะตรงหลัง refresh

    try {
      await markNotificationRead(notification.id);
      router.refresh();
    } catch (err) {
      setIsRead(false); // ถอนกลับ ไม่ให้ UI โกหกว่าอ่านแล้ว
      setError(err instanceof ApiClientError ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  };

  const body = (
    <div className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[14px]",
          isRead ? "bg-lilac-50" : "bg-lilac",
          look.tone,
        )}
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", isRead ? "font-semibold" : "font-extrabold")}>
          {notification.title}
        </p>
        <p className="mt-0.5 text-sm text-muted">{notification.body}</p>
        <time dateTime={notification.createdAt} className="mt-1 block text-xs text-muted-light">
          {new Date(notification.createdAt).toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </div>

      {!isRead && (
        <span
          aria-label="ยังไม่อ่าน"
          className="mt-1 size-2.5 shrink-0 rounded-full bg-brand"
          role="img"
        />
      )}
    </div>
  );

  const shell = cn(
    "block w-full rounded-[var(--radius-card)] border p-4 text-left transition",
    isRead ? "border-line bg-white" : "border-brand-soft bg-lilac-50",
  );

  return (
    <li>
      {notification.link !== null ? (
        <Link
          href={notification.link}
          onClick={() => void markRead()}
          className={cn(shell, "hover:border-brand-soft hover:shadow-[var(--shadow-soft)]")}
        >
          {body}
        </Link>
      ) : isRead ? (
        <div className={shell}>{body}</div>
      ) : (
        <button
          type="button"
          onClick={() => void markRead()}
          className={cn(shell, "cursor-pointer")}
        >
          {body}
        </button>
      )}

      {error !== null && (
        <p role="alert" className="mt-1 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
