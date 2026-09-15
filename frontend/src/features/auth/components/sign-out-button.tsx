import { LogOut } from "lucide-react";

import { signOutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

/**
 * ปุ่มออกจากระบบ — ใช้ Server Action จึงไม่ต้องเป็น client component
 * (ทำงานได้แม้ JavaScript ยังโหลดไม่เสร็จ)
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger",
          className,
        )}
      >
        <LogOut className="size-4" aria-hidden />
        ออกจากระบบ
      </button>
    </form>
  );
}
