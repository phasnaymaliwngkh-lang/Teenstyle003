import { Heart, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CartBadge, CartIcon } from "./cart-badge";
import { MobileMenu } from "./mobile-menu";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";

import {
  NotificationBell,
  NotificationBellFallback,
} from "@/features/notifications/components/notification-bell";

import { getSession } from "@/lib/dal";
import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Navbar หลักของหน้าร้าน (STEP 4)
 *
 * เป็น Server Component เพื่ออ่าน session ได้โดยไม่ต้องส่ง JS ของ auth ไปฝั่ง client
 * แล้วส่งเฉพาะข้อมูลที่จำเป็นให้ client island (UserMenu, MobileMenu)
 *
 * โครงตามสเปค: Logo · Home Shop Looks AI Stylist About · Search Wishlist Account Cart
 * จอเล็กเปลี่ยนเป็น hamburger menu
 */
export async function Navbar() {
  const session = await getSession();

  const user = session
    ? {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        role: session.user.role,
      }
    : null;

  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 text-xl font-extrabold tracking-tight"
        >
          {publicEnv.siteName}
          <span className="text-brand-gradient text-2xl" aria-hidden>
            ✧
          </span>
          <span className="sr-only">หน้าแรก</span>
        </Link>

        <div className="mx-auto">
          <NavLinks />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconLink href="/search" label="ค้นหาสินค้า">
            <Search className="size-5" aria-hidden />
          </IconLink>

          {/**
           * ⚠️ ไอคอนที่แสดงพร้อมกันต้องไม่เกินที่จอ 360px รับได้ (STEP 31)
           *    ปุ่มละ 44px (ห้ามย่อ — กฎ touch target) → โลโก้ + 4 ไอคอน = เต็มพอดี
           *    คนที่ล็อกอินแล้วจะมีกระดิ่งเพิ่มมาเป็นไอคอนที่ 5 แล้วแถบล้นออกนอกจอ
           *    จึงซ่อน "ถูกใจ" บนจอเล็ก **และไปเพิ่มไว้ในเมนู hamburger แทน**
           *    (ซ่อนเฉย ๆ ไม่ได้ เพราะจะไม่มีทางเข้าหน้านั้นจากมือถือเลย)
           */}
          <IconLink href="/wishlist" label="รายการที่ถูกใจ" className="hidden sm:grid">
            <Heart className="size-5" aria-hidden />
          </IconLink>

          {/**
           * กระดิ่งแจ้งเตือน (STEP 24) — แสดงเฉพาะคนที่ล็อกอิน
           * เพราะการแจ้งเตือนผูกกับบัญชี guest จะได้ 401 กลับมาเปล่า ๆ
           * stream แยกเพื่อไม่ให้ทุกหน้าในเว็บรอ API นี้
           */}
          {user !== null && (
            <Suspense fallback={<NotificationBellFallback />}>
              <NotificationBell />
            </Suspense>
          )}

          <div className="hidden lg:block">
            <UserMenu user={user} />
          </div>

          {/* ตัวเลขในตะกร้าอ่านจาก backend — stream แยกเพื่อไม่ให้ navbar รอ */}
          <Suspense fallback={<CartIcon />}>
            <CartBadge />
          </Suspense>

          <MobileMenu
            user={user ? { name: user.name, email: user.email, role: user.role } : null}
          />
        </div>
      </div>
    </header>
  );
}

function IconLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] text-ink transition hover:bg-lilac hover:text-brand-dark",
        className,
      )}
    >
      {children}
    </Link>
  );
}
