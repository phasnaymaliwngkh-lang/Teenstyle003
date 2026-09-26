import { Mail, Phone } from "lucide-react";
import Link from "next/link";

import { FOOTER_SECTIONS, SOCIAL_LINKS } from "./nav-config";

import { publicEnv } from "@/lib/env";

/**
 * Footer ของหน้าร้าน (STEP 4)
 *
 * ข้อมูลติดต่อและลิงก์นโยบายยัง hard-code อยู่ในขั้นนี้
 * STEP 49 (Store Settings) จะย้ายไปดึงจากฐานข้อมูลเพื่อให้ admin แก้ได้เอง
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

            <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-white/60">
              ร้านค้าออนไลน์แฟชั่นสำหรับวัยรุ่น เสื้อผ้าหลากหลายสไตล์ พร้อม AI Stylist
              ที่ช่วยแนะนำการแต่งตัว และ AI Customer Service ที่ตอบได้ตลอด 24 ชั่วโมง
            </p>

            <div className="mt-5 flex flex-wrap gap-2" role="list" aria-label="โซเชียลมีเดีย">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="listitem"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-white/15 px-4 text-xs font-semibold transition hover:border-brand-soft hover:bg-brand"
                >
                  {social.label}
                </a>
              ))}
            </div>
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
          <a
            href="mailto:hello@teenstyle.ai"
            className="flex items-center gap-2 transition hover:text-brand-soft"
          >
            <Mail className="size-4" aria-hidden />
            hello@teenstyle.ai
          </a>
          <a
            href="tel:+6620000000"
            className="flex items-center gap-2 transition hover:text-brand-soft"
          >
            <Phone className="size-4" aria-hidden />
            02-000-0000 (จ.–ส. 9:00–18:00)
          </a>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
          <p>© {year} TEENSTYLE AI. All rights reserved.</p>
          <p>Find your style, be you 💜</p>
        </div>
      </div>
    </footer>
  );
}
