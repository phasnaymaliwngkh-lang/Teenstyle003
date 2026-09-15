import { RotateCcw, Sparkles, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * Hero ของหน้าแรก (STEP 5)
 *
 * ตัวเลข/ข้อความในแถบความน่าเชื่อถือใช้เฉพาะ "ข้อเท็จจริงของร้าน" ที่เป็นจริง
 * (เงื่อนไขส่งฟรีตรงกับคูปอง FREESHIP690 และนโยบายคืนสินค้า 7 วันที่ตั้งไว้)
 * ไม่ใส่ตัวเลขรีวิว/ยอดขายปลอม เพราะระบบยังไม่มีข้อมูลจริง
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-24 size-[520px] rounded-full bg-brand-soft/35 blur-3xl"
      />

      <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-lilac px-4 py-2 text-sm font-semibold text-brand-dark">
            <Sparkles className="size-4" aria-hidden />
            AI Fashion Assistant สำหรับวัยรุ่น
          </span>

          <h1 className="mt-5 text-4xl leading-[1.1] sm:text-5xl lg:text-6xl">
            Find Your Style,
            <br />
            Be You <span className="inline-block">💜</span>
          </h1>

          <p className="mt-4 max-w-[46ch] text-base text-muted sm:text-lg">
            ค้นหาสไตล์ที่ใช่สำหรับคุณ พร้อมคำแนะนำแฟชั่นจาก AI
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/shop"
              className="btn-brand flex min-h-13 items-center justify-center rounded-[var(--radius-pill)] px-8 text-base font-bold transition"
            >
              Shop Now
            </Link>
            <Link
              href="/ai-stylist"
              className="flex min-h-13 items-center justify-center gap-2 rounded-[var(--radius-pill)] border-2 border-lilac bg-white px-8 text-base font-bold text-brand-dark shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:border-brand-soft"
            >
              Try AI Stylist
              <span aria-hidden>✧</span>
            </Link>
          </div>

          <ul className="mt-10 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
            <TrustItem icon={<Truck className="size-4" aria-hidden />} label="ส่งฟรี">
              เมื่อสั่งครบ 690.-
            </TrustItem>
            <TrustItem icon={<RotateCcw className="size-4" aria-hidden />} label="คืนได้ 7 วัน">
              ตามเงื่อนไขของร้าน
            </TrustItem>
            <TrustItem icon={<Sparkles className="size-4" aria-hidden />} label="AI ช่วยเลือก">
              ตอบได้ตลอด 24 ชม.
            </TrustItem>
          </ul>
        </div>

        <div className="relative">
          <div className="relative ml-auto aspect-4/5 w-full max-w-[420px] overflow-hidden rounded-[var(--radius-lg,28px)] bg-lilac-50 shadow-[var(--shadow-float)]">
            <Image
              src="https://images.unsplash.com/photo-1483985988355-763728e1935b?w=900&q=80&auto=format&fit=crop"
              alt="วัยรุ่นแต่งตัวสไตล์แฟชั่นถือถุงช้อปปิ้ง"
              fill
              priority
              sizes="(max-width: 1024px) 90vw, 420px"
              className="object-cover"
            />
          </div>

          <div className="absolute -bottom-4 left-0 flex max-w-[250px] items-center gap-3 rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-float)] sm:-bottom-6">
            <span className="btn-brand grid size-10 shrink-0 place-items-center rounded-full text-lg">
              ✧
            </span>
            <div>
              <p className="text-sm font-extrabold">AI Stylist</p>
              <p className="text-xs text-muted">บอกสไตล์แล้วให้ AI จัดลุคให้</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-lilac text-brand">
        {icon}
      </span>
      <span>
        <span className="block font-bold">{label}</span>
        <span className="block text-xs text-muted">{children}</span>
      </span>
    </li>
  );
}
