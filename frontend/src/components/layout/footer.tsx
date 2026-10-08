import { Mail, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { FOOTER_SECTIONS } from "./nav-config";

import { publicEnv } from "@/lib/env";
import { fetchStoreInfo } from "@/services/store.service";

/**
 * Footer ของหน้าร้าน (STEP 4 · ข้อมูลร้านจากการตั้งค่าร้านตั้งแต่ STEP 49)
 *
 * ⚠️ แก้ตอน STEP 49: เดิมพิมพ์เบอร์ 02-000-0000 (ลิงก์ tel: ด้วย) ที่ร้านไม่มี และปุ่มโซเชียลที่ลิงก์ไป
 *    instagram.com / tiktok.com เฉย ๆ ไม่ใช่โปรไฟล์ของร้าน — ตอนนี้แสดงเฉพาะสิ่งที่ร้านตั้งไว้จริง
 * ⚠️ footer อยู่ทุกหน้า → ส่วนที่อ่านข้อมูลร้านอยู่ใน `<Suspense>` และโหลดไม่ได้ = ไม่แสดงส่วนนั้น
 *    (ห้ามให้ footer พังทั้งหน้า และห้ามแสดงค่าสมมติแทน)
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto bg-ink text-white">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-14 pb-8 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link href="/" className="text-xl font-extrabold">
              {publicEnv.siteName}
              <span className="text-brand-soft" aria-hidden>
                {" "}
                ✧
              </span>
            </Link>

            <p className="mt-3 font-semibold text-brand-soft">Find your style, be you 💜</p>

            <Suspense fallback={null}>
              <FooterAbout />
            </Suspense>
          </div>

          {FOOTER_SECTIONS.map((section) => (
            <nav key={section.title} aria-label={section.title}>
              <h2 className="text-sm font-extrabold">{section.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <Link
                        href={link.href}
                        className="text-sm text-white/60 transition hover:text-brand-soft"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      /* ยังไม่มีหน้านี้จริง — แสดงเป็นข้อความ ไม่ลิงก์ไป 404 */
                      <span
                        className="flex flex-wrap items-center gap-2 text-sm text-white/35"
                        title={`จะสร้างใน STEP ${link.pendingStep}`}
                      >
                        {link.label}
                        <span className="rounded-[var(--radius-pill)] border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
                          STEP {link.pendingStep}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/10 pt-6 text-sm text-white/60">
          {/* แชตบนเว็บมีเสมอ (AI + ส่งต่อเจ้าหน้าที่) — ช่องทางอื่นมาจากการตั้งค่าร้าน */}
          <Link href="/customer-service" className={contactLinkClass}>
            <MessageCircle className="size-4" aria-hidden />
            แชตกับฝ่ายบริการลูกค้า
          </Link>
          <Suspense fallback={null}>
            <FooterContact />
          </Suspense>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
          <p>© {year} TEENSTYLE AI. All rights reserved.</p>
          <p>Find your style, be you 💜</p>
        </div>
      </div>
    </footer>
  );
}

const contactLinkClass = "flex items-center gap-2 break-all transition hover:text-brand-soft";

/** คำอธิบายร้าน + โซเชียลที่ร้านมีจริง */
async function FooterAbout() {
  const store = await fetchStoreInfo().catch(() => null);
  if (store === null) return null;

  return (
    <>
      <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-white/60">{store.description}</p>

      {store.socialLinks.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="โซเชียลมีเดียของร้าน">
          {store.socialLinks.map((social) => (
            <li key={social.label}>
              <a
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-white/15 px-4 text-xs font-semibold transition hover:border-brand-soft hover:bg-brand"
              >
                {social.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** อีเมล · เบอร์โทร (พร้อมเวลาที่มีคนรับสาย) — เฉพาะช่องที่ร้านตั้งไว้ */
async function FooterContact() {
  const store = await fetchStoreInfo().catch(() => null);
  if (store === null) return null;

  return (
    <>
      {store.contactEmail !== null && (
        <a href={`mailto:${store.contactEmail}`} className={contactLinkClass}>
          <Mail className="size-4 shrink-0" aria-hidden />
          {store.contactEmail}
        </a>
      )}
      {store.contactPhone !== null && (
        <a href={`tel:${store.contactPhone.replace(/[^0-9+]/g, "")}`} className={contactLinkClass}>
          <Phone className="size-4 shrink-0" aria-hidden />
          {store.contactPhone} ({store.agentHours})
        </a>
      )}
    </>
  );
}
