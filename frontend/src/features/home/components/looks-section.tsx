import { SectionEmpty, SectionError, SectionHeader } from "@/components/shared/section";
import { LookCard } from "@/features/looks/components/look-card";
import { ApiClientError } from "@/lib/api";
import { fetchLooks } from "@/services/catalog.service";
import type { LookCard as LookCardData } from "@/types/catalog";

/**
 * Look ยอดนิยมบนหน้าแรก — ใช้การ์ดเดียวกับหน้า /looks (STEP 7)
 * ราคารวมและสถานะครบชุดคำนวณที่ backend จากสินค้าจริงในลุค
 *
 * การ์ดลิงก์ไปหน้ารายละเอียดลุค /looks/[slug] (STEP 8)
 */
export async function LooksSection() {
  let items: LookCardData[] | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await fetchLooks(4);
    items = result.items;
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก";
  }

  return (
    <section aria-labelledby="section-looks">
      <div id="section-looks">
        <SectionHeader
          eyebrow="Popular Looks"
          title="Look ที่ได้รับความนิยม"
          subtitle="ชุดที่จัดไว้แล้ว พร้อมใส่ตามได้ทันที — ราคารวมคิดจากสินค้าจริงในลุค"
          action={{ label: "ดูลุคทั้งหมด", href: "/looks" }}
        />
      </div>

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : items && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map((look) => (
            <LookCard key={look.id} look={look} detailHref={`/looks/${look.slug}`} />
          ))}
        </div>
      ) : (
        <SectionEmpty
          message="ยังไม่มี Look ที่เผยแพร่"
          hint="เพิ่ม Look ได้ในระบบหลังบ้าน (STEP 48) หรือรัน npm run db:seed"
        />
      )}
    </section>
  );
}
