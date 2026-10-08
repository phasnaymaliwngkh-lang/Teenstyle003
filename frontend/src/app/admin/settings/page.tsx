import type { Metadata } from "next";

import { SectionError } from "@/components/shared/section";
import { StoreSettingsForm } from "@/features/admin/components/store-settings-form";
import { formatDateTime } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { fetchAdminStoreSettingsOnServer } from "@/services/store.server";
import type { AdminStoreSettings } from "@/types/store";

export const metadata: Metadata = {
  title: "การตั้งค่าร้าน",
  robots: { index: false, follow: false },
};

/**
 * การตั้งค่าร้าน /admin/settings (STEP 49) — ดูและแก้ = `settings:manage` (ADMIN ขึ้นไป)
 *
 * ⚠️ ค่าที่นี่คือแหล่งความจริงเดียวของข้อมูลร้าน — footer · หน้าเกี่ยวกับเรา · หน้าแรก · บทความคลังความรู้ ·
 *    คำตอบของ AI · ด่าน COD · สิทธิ์คืนสินค้า อ่านจากที่เดียวกัน (ค่าส่งอยู่ที่ /admin/shipping)
 */
export default async function AdminSettingsPage() {
  await requirePermission("settings:manage");

  let data: AdminStoreSettings | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminStoreSettingsOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดการตั้งค่าร้านไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl">การตั้งค่าร้าน</h1>
        <p className="mt-1 text-sm text-muted">
          ข้อมูลร้านที่ลูกค้าเห็นทุกหน้า และตัวเลขนโยบายที่ AI เอาไปตอบลูกค้า · ค่าส่งแก้ที่หน้า
          อัตราค่าจัดส่ง
        </p>
        {data !== null && (
          <p className="mt-2 text-xs text-muted">
            แก้ล่าสุด {formatDateTime(data.settings.updatedAt)}
          </p>
        )}
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : (
        <StoreSettingsForm data={data} />
      )}
    </main>
  );
}
