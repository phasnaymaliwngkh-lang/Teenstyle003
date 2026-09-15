import { MessagesSquare, Sparkles } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { title: "บอกความต้องการ", detail: "สไตล์ที่ชอบ สี โอกาสใช้งาน และงบประมาณ" },
  { title: "AI ค้นหาสินค้า", detail: "ค้นจากสินค้าจริงในร้าน ไม่ใช่ข้อมูลที่แต่งขึ้น" },
  { title: "ได้ลุคที่ใส่ได้เลย", detail: "เลือกสี ไซซ์ แล้วเพิ่มลงตะกร้าได้ทันที" },
] as const;

/**
 * Section แนะนำ AI Stylist บนหน้าแรก (STEP 5)
 * ตัวระบบ AI จริงจะสร้างใน STEP 19–21 — ที่นี่เป็นทางเข้าและอธิบายว่าทำอะไรได้
 */
export function AiStylistSection() {
  return (
    <section
      aria-labelledby="section-ai"
      className="relative overflow-hidden rounded-[var(--radius-card)] bg-brand px-6 py-12 text-white sm:px-10 sm:py-14"
      style={{ backgroundImage: "linear-gradient(135deg,#8b5cf6,#7c3aed)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/15 blur-2xl"
      />

      <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-white/20 px-4 py-1.5 text-xs font-bold tracking-widest uppercase">
            <Sparkles className="size-3.5" aria-hidden />
            AI Stylist
          </span>

          <h2 id="section-ai" className="mt-4 text-3xl sm:text-4xl">
            ไม่รู้จะใส่อะไร ให้ AI ช่วยคิด
          </h2>

          <p className="mt-3 max-w-[42ch] text-sm text-white/85 sm:text-base">
            ตอบคำถามสั้น ๆ แล้วรับลุคที่เหมาะกับคุณ — AI แนะนำจากสินค้าที่มีอยู่จริงในร้านเท่านั้น
            ถ้าไม่มีของที่ตรงเงื่อนไข จะบอกตรง ๆ ว่าไม่พบ
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/ai-stylist"
              className="flex min-h-13 items-center justify-center rounded-[var(--radius-pill)] bg-white px-8 font-bold text-brand-dark transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              เริ่มใช้ AI Stylist
            </Link>
            <Link
              href="/ai-stylist"
              className="flex min-h-13 items-center justify-center gap-2 rounded-[var(--radius-pill)] border-2 border-white/50 px-8 font-bold transition hover:bg-white/15"
            >
              <MessagesSquare className="size-4" aria-hidden />
              ถาม Customer Service
            </Link>
          </div>
        </div>

        <ol className="space-y-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-[var(--radius-card)] bg-white/12 p-4 backdrop-blur-sm"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white font-extrabold text-brand-dark">
                {index + 1}
              </span>
              <span>
                <span className="block font-bold">{step.title}</span>
                <span className="block text-sm text-white/80">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
