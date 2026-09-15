import { Hammer } from "lucide-react";
import Link from "next/link";

/**
 * แผงบอกว่าหน้านี้จะถูกสร้างใน STEP ไหน
 *
 * ใช้กับหน้าที่ navbar ลิงก์ไปแล้วแต่ยังไม่ได้สร้างเนื้อหา (STEP 5–9, 22, 45)
 * มีไว้เพื่อไม่ให้เมนูพาไปหน้า 404 และบอกความจริงว่ายังไม่เสร็จ
 */
export function ComingSoon({
  title,
  step,
  description,
  items,
}: {
  title: string;
  step: number;
  description: string;
  items?: readonly string[];
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center shadow-[var(--shadow-soft)] sm:p-10">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-lilac">
          <Hammer className="size-7 text-brand" aria-hidden />
        </div>

        <h1 className="mt-6 text-3xl">{title}</h1>

        <p className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-lilac px-4 py-1.5 text-sm font-semibold text-brand-dark">
          กำลังสร้างใน STEP {step}
        </p>

        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted">{description}</p>

        {items && items.length > 0 && (
          <ul className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm">
            {items.map((item) => (
              <li key={item} className="flex gap-3 rounded-2xl bg-lilac-50 px-4 py-2.5">
                <span className="text-brand-soft" aria-hidden>
                  ✧
                </span>
                <span className="text-muted">{item}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="btn-brand flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] px-6 font-bold transition"
          >
            กลับหน้าแรก
          </Link>
          <Link
            href="/account"
            className="flex min-h-12 items-center justify-center rounded-[var(--radius-pill)] border border-line px-6 font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            บัญชีของฉัน
          </Link>
        </div>
      </div>
    </div>
  );
}
