import { Clock, Mail, MessageCircle, Phone, RotateCcw, Truck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { fetchStoreInfo } from "@/services/store.service";
import type { StoreInfo } from "@/types/store";

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา",
  description:
    "รู้จัก TEENSTYLE AI ร้านแฟชั่นออนไลน์สำหรับวัยรุ่น ช่องทางติดต่อ เวลาทำการ และนโยบายการจัดส่ง คืนสินค้า และชำระเงิน",
  alternates: { canonical: "/about" },
};

/**
 * เกี่ยวกับเรา /about (STEP 49 — เดิมเป็นหน้า "เร็ว ๆ นี้")
 *
 * ทุกค่ามาจากการตั้งค่าร้าน (`GET /api/store`) ชุดเดียวกับ footer บทความคลังความรู้ และคำตอบของ AI
 * · ช่องทางที่ร้านไม่มีไม่ถูกพูดถึง · ค่าส่งไม่อยู่ที่นี่ (ลิงก์ไปบทความที่แสดงอัตราจริงจากตาราง ShippingRate)
 */
export default async function AboutPage() {
  let store: StoreInfo | null = null;
  let errorMessage: string | null = null;

  try {
    store = await fetchStoreInfo();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดข้อมูลร้านไม่สำเร็จ";
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-12 sm:px-6">
      <header>
        <h1 className="text-3xl sm:text-4xl">เกี่ยวกับ TEENSTYLE AI</h1>
        <p className="mt-2 font-semibold text-brand-dark">Find your style, be you 💜</p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : store === null ? null : (
        <StoreDetails store={store} />
      )}
    </div>
  );
}

const cardClass =
  "rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-soft)]";
const linkClass = "font-semibold break-all text-brand-dark underline-offset-4 hover:underline";

function StoreDetails({ store }: { store: StoreInfo }) {
  return (
    <div className="mt-8 space-y-6">
      <p className="text-base leading-relaxed text-ink-soft sm:text-lg">{store.description}</p>

      <section aria-labelledby="about-contact" className={cardClass}>
        <h2 id="about-contact" className="text-xl">
          ติดต่อเรา
        </h2>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              <Link href="/customer-service" className={linkClass}>
                แชตกับฝ่ายบริการลูกค้า
              </Link>{" "}
              — AI ตอบทันที{store.aiHours} และส่งต่อให้เจ้าหน้าที่คนจริงได้
            </span>
          </li>
          {store.contactEmail !== null && (
            <li className="flex items-start gap-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <a href={`mailto:${store.contactEmail}`} className={linkClass}>
                {store.contactEmail}
              </a>
            </li>
          )}
          {store.contactPhone !== null && (
            <li className="flex items-start gap-3">
              <Phone className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <a href={`tel:${store.contactPhone.replace(/[^0-9+]/g, "")}`} className={linkClass}>
                {store.contactPhone}
              </a>
            </li>
          )}
          <li className="flex items-start gap-3">
            <Clock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>เจ้าหน้าที่คนจริง: {store.agentHours}</span>
          </li>
        </ul>

        {store.socialLinks.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="โซเชียลมีเดียของร้าน">
            {store.socialLinks.map((social) => (
              <li key={social.label}>
                <a
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                >
                  {social.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="about-policy" className={cardClass}>
        <h2 id="about-policy" className="text-xl">
          นโยบายของร้าน
        </h2>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <Truck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              ส่งของวัน{store.shippingDays} ตัดรอบเวลา {store.cutoffTime} ·{" "}
              <Link href="/faq" className={linkClass}>
                ดูค่าส่งและระยะเวลา
              </Link>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              แจ้งเปลี่ยนไซซ์หรือคืนสินค้าได้ภายใน {store.returnWindowDays} วันหลังได้รับสินค้า
              ตามเงื่อนไขของร้าน
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Wallet className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              เก็บเงินปลายทาง (COD) รับยอดไม่เกิน {store.codMaxTotal.toLocaleString("th-TH")} บาท ·
              ไม่มีค่าธรรมเนียมเพิ่ม
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted">
          รายละเอียดครบทุกข้ออยู่ใน{" "}
          <Link href="/faq" className={linkClass}>
            คำถามที่พบบ่อย
          </Link>
        </p>
      </section>
    </div>
  );
}
