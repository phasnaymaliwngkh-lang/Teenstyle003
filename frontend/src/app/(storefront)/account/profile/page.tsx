import { Award, CalendarClock, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { ProfileForm } from "@/features/account/components/profile-form";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchMyProfileOnServer } from "@/services/customer.server";
import { fetchMyLoyaltyOnServer } from "@/services/loyalty.server";
import type { MyProfile } from "@/types/customer";
import type { MyLoyalty } from "@/types/loyalty";

export const metadata: Metadata = {
  title: "ข้อมูลส่วนตัว",
  description: "แก้ชื่อ เบอร์โทร วันเกิด และการตั้งค่าความเป็นส่วนตัวของบัญชี",
  robots: { index: false, follow: false },
};

/** หน้าข้อมูลส่วนตัว /account/profile (STEP 25) */
export default async function ProfilePage() {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/profile")}`);
  }

  let profile: MyProfile | null = null;
  let errorMessage: string | null = null;

  // แต้มโหลดแยกจากโปรไฟล์ — โหลดแต้มไม่ได้ต้องไม่ทำให้แก้ข้อมูลส่วนตัวไม่ได้ (กฎ STEP 5 ข้อ 1)
  const [profileResult, loyaltyResult] = await Promise.allSettled([
    fetchMyProfileOnServer(),
    fetchMyLoyaltyOnServer(),
  ]);

  if (profileResult.status === "fulfilled") {
    profile = profileResult.value;
  } else {
    errorMessage =
      profileResult.reason instanceof ApiClientError
        ? profileResult.reason.message
        : "โหลดข้อมูลส่วนตัวไม่สำเร็จ";
  }

  const loyalty: MyLoyalty | null =
    loyaltyResult.status === "fulfilled" ? loyaltyResult.value : null;

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          My Profile
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">ข้อมูลส่วนตัว</h1>
        <p className="mt-2 text-sm text-muted">
          ข้อมูลนี้ใช้ติดต่อเรื่องคำสั่งซื้อ — ที่อยู่จัดส่งอยู่ในหน้าสมุดที่อยู่แยกกัน
        </p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : profile === null ? null : (
        <>
          <section className="mt-8 grid gap-3 sm:grid-cols-3">
            <InfoTile
              icon={<ShieldCheck className="size-5 text-brand" aria-hidden />}
              label="บทบาท"
              value={profile.role}
            />
            <InfoTile
              icon={<Award className="size-5 text-brand" aria-hidden />}
              label="ระดับสมาชิก"
              /* โหลดไม่ได้ → บอกว่าโหลดไม่ได้ ห้ามโชว์ "0 แต้ม" (0 แปลว่าไม่มีแต้ม ไม่ใช่ยังไม่รู้) */
              value={
                loyalty === null
                  ? "โหลดแต้มไม่สำเร็จ"
                  : `${loyalty.tier.name} · ${loyalty.points.toLocaleString("th-TH")} แต้ม`
              }
            />
            <InfoTile
              icon={<CalendarClock className="size-5 text-brand" aria-hidden />}
              label="เป็นสมาชิกตั้งแต่"
              value={new Date(profile.memberSince).toLocaleDateString("th-TH", {
                dateStyle: "medium",
              })}
            />
          </section>

          <p className="mt-3 text-xs text-muted">
            บทบาทเป็นค่าที่ร้านกำหนด · ระดับสมาชิกและแต้มคิดจากคำสั่งซื้อจริง แก้จากหน้านี้ไม่ได้
            {" · "}
            <Link href="/account/points" className="font-semibold text-brand-dark underline">
              ดูแต้มสะสมและประวัติ
            </Link>
          </p>

          <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
            <h2 className="text-lg">แก้ข้อมูลของฉัน</h2>
            <div className="mt-5">
              <ProfileForm profile={profile} />
            </div>
          </section>

          <Link
            href="/account/addresses"
            className="mt-6 flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] transition hover:border-brand-soft hover:shadow-[var(--shadow-lift)]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-lilac">
              <MapPin className="size-6 text-brand" aria-hidden />
            </span>
            <span>
              <span className="block font-extrabold">สมุดที่อยู่</span>
              <span className="block text-sm text-muted">
                {profile.addressCount === 0
                  ? "ยังไม่มีที่อยู่บันทึกไว้ — เพิ่มไว้จะสั่งซื้อได้เร็วขึ้น"
                  : `บันทึกไว้ ${profile.addressCount} แห่ง`}
              </span>
            </span>
          </Link>
        </>
      )}
    </main>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-semibold">{value}</p>
    </div>
  );
}
