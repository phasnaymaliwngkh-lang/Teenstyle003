"use client";

import { Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ApiClientError } from "@/lib/api";
import { updateMyProfile } from "@/services/customer.service";
import type { MyProfile } from "@/types/customer";

/**
 * ฟอร์มแก้ข้อมูลส่วนตัว (STEP 25)
 *
 * ⚠️ **อีเมลแก้ไม่ได้** และแสดงเป็นข้อความอ่านอย่างเดียวพร้อมบอกเหตุผล
 *    อีเมลคือตัวระบุตัวตนของบัญชี Google ที่ใช้เข้าสู่ระบบ เปลี่ยนแล้วจะล็อกอินกลับเข้าบัญชีเดิมไม่ได้
 *    (และเป็นค่าที่ callback `signIn` ใช้ผูกบัญชี — ดูเหตุผลของ `allowDangerousEmailAccountLinking`)
 *
 * ⚠️ **บทบาท สถานะ แต้ม และระดับสมาชิกไม่มีช่องให้แก้** เพราะเป็นค่าที่ร้านกำหนด
 *    ส่งไปทาง body ก็ถูก backend ตัดทิ้ง (มีเทสต์ยืนยัน)
 *
 * ⚠️ **รูปโปรไฟล์ยังเปลี่ยนเองไม่ได้** — มาจากบัญชี Google เท่านั้น
 *    การรับ URL รูปจาก client คือการยอมให้แปะรูปจากที่ไหนก็ได้ (ปัญหาเดียวกับรูปในรีวิว STEP 23)
 *    การอัปโหลดจริงเป็นงานของ STEP 47
 */
const inputClass =
  "mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20";

export function ProfileForm({ profile }: { profile: MyProfile }) {
  const router = useRouter();
  const formId = useId();

  const [name, setName] = useState(profile.name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [birthDate, setBirthDate] = useState(profile.birthDate ?? "");
  const [allowPersonalization, setAllowPersonalization] = useState(profile.allowPersonalization);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** วันนี้ในรูปแบบ YYYY-MM-DD — ใช้เป็น max ของช่องวันเกิด */
  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setSaved(false);

    try {
      await updateMyProfile({
        name: name.trim(),
        phone: phone.trim() === "" ? null : phone.trim(),
        birthDate: birthDate === "" ? null : birthDate,
        allowPersonalization,
      });

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* อีเมล — อ่านอย่างเดียว */}
      <div>
        <span className="text-xs font-bold">อีเมลที่ใช้เข้าสู่ระบบ</span>
        <div className="mt-1 flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-3 text-sm">
          <Lock className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="break-all font-semibold">{profile.email}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          เปลี่ยนไม่ได้ — เป็นตัวระบุบัญชี Google ที่ใช้เข้าสู่ระบบ
          {profile.emailVerified ? " (ยืนยันแล้ว)" : ""}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-name`} className="text-xs font-bold">
            ชื่อที่ใช้แสดง
          </label>
          <input
            id={`${formId}-name`}
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            ในรีวิวสินค้าจะแสดงแบบย่อ เช่น &ldquo;สมชาย ก.&rdquo; ไม่ใช่ชื่อเต็ม
          </p>
        </div>

        <div>
          <label htmlFor={`${formId}-phone`} className="text-xs font-bold">
            เบอร์โทร <span className="font-normal text-muted">(ไม่บังคับ)</span>
          </label>
          <input
            id={`${formId}-phone`}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="08x-xxx-xxxx"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">ร้านใช้ติดต่อเรื่องคำสั่งซื้อเท่านั้น</p>
        </div>

        <div>
          <label htmlFor={`${formId}-birthDate`} className="text-xs font-bold">
            วันเกิด <span className="font-normal text-muted">(ไม่บังคับ)</span>
          </label>
          <input
            id={`${formId}-birthDate`}
            type="date"
            max={today}
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 text-sm">
        <input
          type="checkbox"
          checked={allowPersonalization}
          onChange={(event) => setAllowPersonalization(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]"
        />
        <span>
          <span className="font-semibold">ให้ระบบแนะนำสินค้าจากพฤติกรรมของฉัน</span>
          <span className="block text-xs text-muted">
            ปิดได้ทุกเมื่อ — ปิดแล้วยังใช้ AI Stylist และค้นหาได้ปกติ
            เพียงแต่คำแนะนำจะไม่อ้างอิงประวัติของคุณ
          </span>
        </span>
      </label>

      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div aria-live="polite">
        {saved && error === null && (
          <p className="text-sm font-semibold text-success">บันทึกข้อมูลส่วนตัวแล้ว</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn-brand flex min-h-12 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition disabled:opacity-50"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        บันทึกข้อมูล
      </button>
    </form>
  );
}
