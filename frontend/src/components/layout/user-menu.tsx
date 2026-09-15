"use client";

import { ChevronDown, LayoutDashboard, LogOut, User as UserIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { signOutAction } from "@/features/auth/actions";
import { isStaffRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface UserMenuProps {
  user: {
    name: string | null | undefined;
    email: string | null | undefined;
    image: string | null | undefined;
    role: string;
  } | null;
}

/**
 * ปุ่มบัญชีบน navbar
 *
 * - ยังไม่ล็อกอิน → ลิงก์ไปหน้าเข้าสู่ระบบ (ไม่ต้องมี JS)
 * - ล็อกอินแล้ว → เมนูย่อยแสดงชื่อ อีเมล ลิงก์บัญชี/หลังบ้าน และปุ่มออกจากระบบ
 *
 * ปุ่มออกจากระบบใช้ Server Action ผ่าน <form> จึงทำงานได้แม้ JS โหลดไม่เสร็จ
 */
export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!user) {
    return (
      <Link
        href="/signin"
        className="grid size-11 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac hover:text-brand-dark"
        aria-label="เข้าสู่ระบบ"
      >
        <UserIcon className="size-5" aria-hidden />
      </Link>
    );
  }

  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] py-1 pr-2 pl-1 transition hover:bg-lilac"
      >
        <span className="sr-only">เมนูบัญชีของ {user.name ?? user.email}</span>
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={32}
            height={32}
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <span className="btn-brand grid size-8 place-items-center rounded-full text-sm font-bold">
            {initial}
          </span>
        )}
        <ChevronDown
          className={cn("size-4 text-muted transition", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-float)]"
        >
          <div className="border-b border-line bg-lilac-50 px-4 py-3">
            <p className="truncate font-bold">{user.name ?? "บัญชีของฉัน"}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-1 inline-block rounded-[var(--radius-pill)] bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
              {user.role}
            </p>
          </div>

          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-lilac-50"
          >
            <UserIcon className="size-4 text-brand" aria-hidden />
            บัญชีของฉัน
          </Link>

          {isStaffRole(user.role) && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-lilac-50"
            >
              <LayoutDashboard className="size-4 text-brand" aria-hidden />
              Admin Dashboard
            </Link>
          )}

          <form action={signOutAction} className="border-t border-line">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-danger/5 hover:text-danger"
            >
              <LogOut className="size-4" aria-hidden />
              ออกจากระบบ
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
