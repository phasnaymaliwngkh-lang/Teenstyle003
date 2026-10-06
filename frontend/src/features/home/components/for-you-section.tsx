import Link from "next/link";

import { SectionEmpty, SectionError, SectionHeader } from "@/components/shared/section";
import { forYouHeading } from "@/features/home/lib/for-you";
import { ProductCard } from "@/features/products/components/product-card";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchForYouOnServer } from "@/services/recommendation.server";
import type { ForYouResult } from "@/types/recommendation";

/**
 * "แนะนำสำหรับคุณ" บนหน้าแรก (STEP 46)
 *
 * หัวข้อเปลี่ยนตามความจริง (`forYouHeading`) — มีประวัติ = "แนะนำสำหรับคุณ" · ไม่มี/ปิดไว้ = "ยอดนิยมในร้าน"
 * เหตุผลใต้การ์ดมาจาก backend ทุกบรรทัด — หน้าเว็บไม่แต่งเหตุผลเอง
 * ห่อ error ไว้เอง (กฎ STEP 5 ข้อ 1) · Loading มาจาก <Suspense> ในหน้า
 */
export async function ForYouSection() {
  const session = await getSession();
  let result: ForYouResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchForYouOnServer(session !== null, 4);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดสินค้าแนะนำไม่สำเร็จ";
  }

  const heading = result === null ? null : forYouHeading(result);

  return (
    <section aria-labelledby="section-for-you">
      <div id="section-for-you">
        <SectionHeader
          {...(heading ? { eyebrow: heading.eyebrow, subtitle: heading.subtitle } : {})}
          // โหลดไม่สำเร็จ = ไม่รู้ว่าเป็นโหมดไหน จึงใช้หัวข้อกลาง ๆ (ไม่อ้างว่า "สำหรับคุณ")
          title={heading?.title ?? "สินค้าแนะนำ"}
          action={{ label: "ดูทั้งหมด", href: "/shop" }}
        />
      </div>

      {heading?.showOptInLink && (
        <p className="-mt-4 mb-4 text-sm">
          <Link
            href="/account/profile#personalization"
            className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline"
          >
            เปิดการแนะนำจากพฤติกรรมได้ที่ข้อมูลส่วนตัว
          </Link>
        </p>
      )}

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : result !== null && result.items.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {result.items.map((item) => (
            <ProductCard
              key={item.product.id}
              product={item.product}
              // โหมดเฉพาะบุคคล: ใบที่เติมให้ครบก็บอกว่าเป็นยอดนิยม — ไม่ให้ดูเหมือนมาจากประวัติ
              {...(heading?.showReasons ? { note: item.reason } : {})}
            />
          ))}
        </div>
      ) : (
        <SectionEmpty
          message="ยังไม่มีสินค้าให้แนะนำ"
          hint="ส่วนนี้แสดงเฉพาะสินค้าที่พร้อมขายจริง — เมื่อมีสินค้าที่มีของในคลัง จะแสดงที่นี่อัตโนมัติ"
        />
      )}
    </section>
  );
}
