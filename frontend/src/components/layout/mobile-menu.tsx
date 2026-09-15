"use client";

import { LayoutDashboard, LogOut, Menu, User as UserIcon, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { MAIN_NAV } from "./nav-config";

import { signOutAction } from "@/features/auth/actions";
import { isStaffRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export interface MobileMenuProps {
  user: {
    name: string | null | undefined;
    email: string | null | undefined;
    role: string;
  } | null;
}

/**
 * Hamburger menu สำหรับจอเล็ก (STEP 4)
 *
 * - ปิดด้วยปุ่ม X, คลิกพื้นหลัง หรือกด Esc
 * - ล็อก scroll ของหน้าตอนเปิด
 * - ปิดอัตโนมัติเมื่อเปลี่ยนหน้า
 * - ทุกปุ่มสูงอย่างน้อย 44px ตามกฎ touch target
 */
export function MobileMenu({ user }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [menuPathname, setMenuPathname] = useState(pathname);

  /**
   * ปิดเมนูเมื่อเปลี่ยนหน้า (กดลิงก์ หรือกด back/forward ของเบราว์เซอร์)
   *
   * ใช้วิธี "ปรับ state ระหว่าง render เมื่อค่าที่ derive มาเปลี่ยน" ตามที่ React แนะนำ
   * ไม่ใช้ useEffect เพราะ setState ใน effect ทำให้ render ซ้อน
   * (กฎ react-hooks/set-state-in-effect ของ Next 16 ห้ามไว้)
   */
  if (menuPathname !== pathname) {
    setMenuPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="เปิดเมนู"
        className="grid size-11 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm lg:hidden"
            aria-hidden
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label="เมนู"
            className="fixed inset-y-0 right-0 z-50 flex w-[min(320px,85vw)] flex-col bg-white shadow-[var(--shadow-float)] lg:hidden"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-lg font-extrabold">
                TeenStyle <span className="text-brand-gradient">✧</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="ปิดเมนู"
                className="grid size-11 place-items-center rounded-[var(--radius-pill)] transition hover:bg-lilac"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto p-3">
              {MAIN_NAV.map((item) => {
                const isActive =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center justify-between rounded-[var(--radius-sm,12px)] px-4 text-base font-semibold transition",
                      isActive ? "bg-lilac text-brand-dark" : "hover:bg-lilac-50",
                    )}
                  >
                    {item.label}
                    {item.pendingStep && (
                      <span className="rounded-[var(--radius-pill)] bg-lilac-50 px-2 py-0.5 text-[11px] font-semibold text-muted">
                        STEP {item.pendingStep}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-line p-3">
              {user ? (
                <>
                  <div className="px-4 py-2">
                    <p className="truncate font-bold">{user.name ?? "บัญชีของฉัน"}</p>
                    <p className="truncate text-xs text-muted">{user.email}</p>
                    <p className="mt-1 inline-block rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
                      {user.role}
                    </p>
                  </div>

                  <Link
                    href="/account"
                    className="flex min-h-12 items-center gap-3 rounded-[12px] px-4 font-semibold transition hover:bg-lilac-50"
                  >
                    <UserIcon className="size-4 text-brand" aria-hidden />
                    บัญชีของฉัน
                  </Link>

                  {isStaffRole(user.role) && (
                    <Link
                      href="/admin"
                      className="flex min-h-12 items-center gap-3 rounded-[12px] px-4 font-semibold transition hover:bg-lilac-50"
                    >
                      <LayoutDashboard className="size-4 text-brand" aria-hidden />
                      Admin Dashboard
                    </Link>
                  )}

                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-4 font-semibold transition hover:bg-danger/5 hover:text-danger"
                    >
                      <LogOut className="size-4" aria-hidden />
                      ออกจากระบบ
                    </button>
                  </form>
                </>
              ) : (
                <Link
                  href="/signin"
                  className="btn-brand flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] font-bold transition"
                >
                  เข้าสู่ระบบ
                </Link>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
