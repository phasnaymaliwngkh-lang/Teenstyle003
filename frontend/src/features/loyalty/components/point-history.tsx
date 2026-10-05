import Link from "next/link";

import { formatDateTime } from "@/features/orders/lib/labels";
import { cn } from "@/lib/utils";
import {
  POINT_TRANSACTION_LABEL,
  type AdminPointTransaction,
  type PointTransaction,
} from "@/types/loyalty";

/**
 * ประวัติแต้ม (STEP 42) — ทุกแถวคือรายการจริงในสมุดแต้มที่ append-only
 *
 * แสดงยอดคงเหลือหลังแต่ละรายการด้วย เพื่อให้ลูกค้าไล่ได้เองว่าแต้มมาจากไหนและหายไปไหน
 * ลิงก์ไปหน้าคำสั่งซื้อมีเฉพาะเมื่อ backend บอกเลขมา (ห้ามเดาลิงก์ — กฎ STEP 24 ข้อ 10)
 */
export function PointHistory({
  items,
  orderHref,
}: {
  items: (PointTransaction | AdminPointTransaction)[];
  /** สร้างลิงก์ไปคำสั่งซื้อ — หน้าลูกค้ากับหลังบ้านไปคนละที่ · ไม่ส่งมา = ไม่ทำลิงก์ */
  orderHref?: (orderNumber: string) => string;
}) {
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white">
      {items.map((item) => {
        const actor = "createdBy" in item ? item.createdBy : undefined;

        return (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{POINT_TRANSACTION_LABEL[item.type]}</p>
              <p className="mt-0.5 text-sm break-words text-ink-soft">{item.description}</p>
              <p className="mt-1 text-xs text-muted">
                {formatDateTime(item.createdAt)}
                {item.orderNumber !== null && orderHref !== undefined && (
                  <>
                    {" · "}
                    <Link href={orderHref(item.orderNumber)} className="underline">
                      {item.orderNumber}
                    </Link>
                  </>
                )}
                {actor !== undefined && (
                  <>
                    {" · "}
                    {actor !== null
                      ? `โดย ${actor.name ?? actor.email}`
                      : item.type === "ADJUSTMENT"
                        ? // ห้ามใส่ชื่อปลอมให้ช่องไม่ว่าง (กฎ STEP 27 ข้อ 3)
                          "ไม่ทราบผู้ปรับ (บัญชีถูกลบแล้ว หรือเป็นยอดยกมา)"
                        : "ระบบ"}
                  </>
                )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  "text-base font-extrabold",
                  item.delta > 0 ? "text-success" : item.delta < 0 ? "text-danger" : "text-muted",
                )}
              >
                {item.delta > 0 ? "+" : ""}
                {item.delta.toLocaleString("th-TH")}
              </p>
              <p className="text-xs text-muted">
                คงเหลือ {item.balanceAfter.toLocaleString("th-TH")}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
