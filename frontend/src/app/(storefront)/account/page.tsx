import { Award, Mail, Package, ShieldCheck, ShoppingBag, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { requireUser } from "@/lib/dal";
import { isStaffRole } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "บัญชีของฉัน",
};

const TIER_LABEL: Record<string, string> = {
  MEMBER: "Member",
  SILVER: "Silver",
  GOLD: "Gold",
  VIP: "VIP",
};

export default async function AccountPage() {
  // ตรวจสิทธิ์จริงที่นี่ ไม่พึ่ง proxy (proxy เป็นแค่ optimistic check)
  const session = await requireUser();
  const { user } = session;

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-3xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-lilac px-4 py-2 text-sm font-semibold text-brand-dark">
              <Sparkles className="size-4" aria-hidden />
              บัญชีของฉัน
            </span>
            <h1 className="mt-4 text-3xl">สวัสดี {user.name ?? "คุณลูกค้า"} 💜</h1>
            <p className="mt-2 text-sm text-muted">
              จัดการข้อมูลส่วนตัว คำสั่งซื้อ และสิ่งที่ถูกใจได้จากที่นี่
            </p>
          </div>
          <SignOutButton />
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <InfoCard icon={<Mail className="size-5 text-brand" aria-hidden />} label="อีเมล">
            <span className="break-all">{user.email}</span>
          </InfoCard>
          <InfoCard icon={<ShieldCheck className="size-5 text-brand" aria-hidden />} label="บทบาท">
            {user.role}
          </InfoCard>
          <InfoCard icon={<Award className="size-5 text-brand" aria-hidden />} label="ระดับสมาชิก">
            {TIER_LABEL[user.loyaltyTier] ?? user.loyaltyTier} · {user.points} แต้ม
          </InfoCard>
        </section>

        {isStaffRole(user.role) && (
          <div className="mt-6 rounded-[var(--radius-card)] border border-brand-soft bg-lilac-50 p-5">
            <p className="text-sm">
              คุณมีสิทธิ์เข้าระบบหลังบ้าน —{" "}
              <Link href="/admin" className="font-bold text-brand underline">
                ไปที่ Admin Dashboard
              </Link>
            </p>
          </div>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/account/orders"
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] transition hover:border-brand-soft hover:shadow-[var(--shadow-lift)]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-lilac">
              <Package className="size-6 text-brand" aria-hidden />
            </span>
            <span>
              <span className="block font-extrabold">ประวัติคำสั่งซื้อ</span>
              <span className="block text-sm text-muted">
                ดูสถานะ ติดตามพัสดุ และชำระเงินที่ค้าง
              </span>
            </span>
          </Link>

          <Link
            href="/cart"
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] transition hover:border-brand-soft hover:shadow-[var(--shadow-lift)]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-lilac">
              <ShoppingBag className="size-6 text-brand" aria-hidden />
            </span>
            <span>
              <span className="block font-extrabold">ตะกร้าสินค้า</span>
              <span className="block text-sm text-muted">ดูของที่เลือกไว้แล้วสั่งซื้อต่อ</span>
            </span>
          </Link>
        </section>

        <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
          <h2 className="text-lg font-extrabold">ยังไม่เปิดใช้งานในขั้นนี้</h2>
          <p className="mt-2 text-sm text-muted">ส่วนที่เหลือจะเพิ่มตามลำดับ STEP</p>
          <ul className="mt-5 space-y-3 text-sm">
            <PendingItem step={22}>Wishlist ที่บันทึกในบัญชี</PendingItem>
            <PendingItem step={25}>แก้ข้อมูลส่วนตัวและสมุดที่อยู่</PendingItem>
            <PendingItem step={42}>แลกแต้มและสิทธิประโยชน์ตามระดับสมาชิก</PendingItem>
            <PendingItem step={43}>ขอคืนสินค้า / คืนเงิน</PendingItem>
            <PendingItem step={53}>ดาวน์โหลดและลบข้อมูลส่วนตัว</PendingItem>
          </ul>
        </section>
      </div>
    </main>
  );
}

function InfoCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-semibold">{children}</p>
    </div>
  );
}

function PendingItem({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lilac text-xs font-bold text-brand-dark">
        {step}
      </span>
      <span className="text-muted">{children}</span>
    </li>
  );
}
