"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MAIN_NAV } from "./nav-config";

import { cn } from "@/lib/utils";

/**
 * เมนูหลักบนจอใหญ่ — เป็น client component เพราะต้องรู้ path ปัจจุบัน
 * เพื่อไฮไลต์เมนูที่กำลังเปิดอยู่ (usePathname ใช้ได้เฉพาะฝั่ง client)
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="hidden items-center gap-1 lg:flex">
      {MAIN_NAV.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold transition",
              isActive ? "text-brand" : "text-ink-soft hover:bg-lilac hover:text-brand-dark",
            )}
          >
            {item.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute bottom-1 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-brand"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
