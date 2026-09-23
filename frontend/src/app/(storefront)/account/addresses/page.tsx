import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { AddressBook } from "@/features/account/components/address-book";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchMyAddressesOnServer } from "@/services/customer.server";
import type { AddressListResult } from "@/types/customer";

export const metadata: Metadata = {
  title: "สมุดที่อยู่",
  description: "จัดการที่อยู่จัดส่งที่บันทึกไว้ในบัญชี",
  robots: { index: false, follow: false },
};

/**
 * หน้าสมุดที่อยู่ /account/addresses (STEP 25)
 *
 * ⚠️ ต้องบอกให้ชัดว่า **แก้ที่อยู่ที่นี่ไม่เปลี่ยนปลายทางของคำสั่งซื้อที่สั่งไปแล้ว**
 *    ระบบเก็บที่อยู่ปลายทางของแต่ละใบไว้เป็น snapshot ตอนสั่ง (STEP 10)
 *    ถ้าไม่บอก ลูกค้าจะเข้าใจว่าแก้แล้วของที่กำลังส่งจะเปลี่ยนที่ส่งตาม แล้วของไปถึงที่เดิม
 */
export default async function AddressBookPage() {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/addresses")}`);
  }

  let result: AddressListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchMyAddressesOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดสมุดที่อยู่ไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Address Book
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">สมุดที่อยู่</h1>
        <p className="mt-2 text-sm text-muted">
          ที่อยู่ที่บันทึกไว้จะถูกเลือกให้ตอนชำระเงิน — เพิ่มได้ไม่เกิน 20 แห่ง
        </p>
      </header>

      <div className="mt-6 flex gap-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <p className="text-sm text-ink-soft">
          <span className="font-bold">แก้ที่อยู่ที่นี่ไม่เปลี่ยนคำสั่งซื้อที่สั่งไปแล้ว</span> —
          ระบบเก็บที่อยู่ปลายทางของแต่ละใบไว้ตอนกดสั่งซื้อ
          ถ้าต้องการเปลี่ยนที่ส่งของใบที่ยังไม่ถึงมือ ให้{" "}
          <Link href="/customer-service" className="font-semibold text-brand underline">
            แจ้งเจ้าหน้าที่
          </Link>{" "}
          โดยตรง
        </p>
      </div>

      <section className="mt-6">
        {errorMessage !== null ? (
          <SectionError message={errorMessage} />
        ) : result === null ? null : (
          <AddressBook addresses={result.items} />
        )}
      </section>

      <p className="mt-8 text-sm">
        <Link href="/account/profile" className="font-semibold text-brand underline">
          ← กลับไปหน้าข้อมูลส่วนตัว
        </Link>
      </p>
    </main>
  );
}
