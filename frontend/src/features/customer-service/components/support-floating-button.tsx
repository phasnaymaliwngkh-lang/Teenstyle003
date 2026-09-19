"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headphones } from "lucide-react";

export function SupportFloatingButton() {
  const pathname = usePathname();

  // ไม่แสดงปุ่มลอยเมื่ออยู่ที่หน้า customer-service หรือฝั่ง admin หรือ checkout
  if (
    pathname?.startsWith("/customer-service") ||
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/checkout") ||
    pathname?.startsWith("/signin")
  ) {
    return null;
  }

  return (
    <Link
      href="/customer-service"
      title="ฝ่ายบริการลูกค้าและสอบถามข้อมูล"
      aria-label="ติดต่อฝ่ายบริการลูกค้า"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-white shadow-float transition-all duration-300 hover:scale-105 hover:bg-brand-dark hover:shadow-brand focus:outline-hidden focus:ring-4 focus:ring-brand-soft"
    >
      <div className="relative">
        <Headphones className="h-5 w-5" />
        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-success border border-brand" />
      </div>
      <span className="hidden sm:inline text-xs font-bold tracking-wide">
        ช่วยเหลือ / ติดต่อเรา
      </span>
    </Link>
  );
}
