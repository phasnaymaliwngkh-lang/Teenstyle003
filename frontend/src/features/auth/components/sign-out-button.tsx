import { LogOut } from "lucide-react";

import { signOutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

/**
 * ปุ่มออกจากระบบ — ใช้ Server Action จึงไม่ต้องเป็น client component
 * (ทำงานได้แม้ JavaScript ยังโหลดไม่เสร็จ)
 */
export function SignOutButton({
  className,
  compactOnMobile = false,
}: {
  className?: string;
  /**
   * บนจอเล็กเหลือเฉพาะไอคอน (STEP 31) — ใช้กับแถบหลังบ้านที่พื้นที่ไม่พอ
   * ปุ่มยังกว้าง/สูง 44px ตามกฎ touch target และยังมีชื่อให้ screen reader ผ่าน aria-label
   */
  compactOnMobile?: boolean;
}) {
  return (
    <form action={signOutAction} className={compactOnMobile ? "shrink-0" : undefined}>
      <button
        type="submit"
        aria-label={compactOnMobile ? "ออกจากระบบ" : undefined}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line text-sm font-semibold transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger",
          compactOnMobile ? "min-w-11 justify-center sm:px-4" : "px-4",
          className,
        )}
      >
        <LogOut className="size-4" aria-hidden />
        <span className={compactOnMobile ? "hidden whitespace-nowrap sm:inline" : undefined}>
          ออกจากระบบ
        </span>
      </button>
    </form>
  );
}
