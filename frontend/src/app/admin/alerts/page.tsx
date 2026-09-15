import { AlertTriangle, BellOff, CheckCircle2, Mail, PackageX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import {
  AcknowledgeButton,
  ScanAlertsButton,
} from "@/features/admin/components/stock-alert-actions";
import { formatDateTime } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchStockAlertsOnServer } from "@/services/admin.server";
import type { StockAlert, StockAlertListResult } from "@/types/admin";

export const metadata: Metadata = {
  title: "แจ้งเตือนสต็อก",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/alerts", ["severity"]);

/**
 * แจ้งเตือนสต็อก (STEP 16)
 *
 * ⚠️ รายการนี้ **คำนวณสดจากฐานข้อมูลทุกครั้ง** ของกลับมาเต็ม = หายจากรายการทันที
 *    จึงไม่มีทางเห็นการเตือนที่ไม่จริงอีกต่อไป
 * ⚠️ "รับทราบ" ปิดเฉพาะการแจ้งเตือน **ไม่ได้แก้ปัญหาสต็อก** — UI ต้องบอกให้ชัด
 *    ไม่งั้นแอดมินจะเข้าใจว่ากดแล้วเรื่องจบ
 * ⚠️ ช่องทางที่ยังใช้ไม่ได้ (อีเมล) ต้องแสดงเหตุผลตรง ๆ ห้ามทำเหมือนส่งได้
 */
export default async function StockAlertsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("inventory:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeSeverity = params.get("severity");

  let data: StockAlertListResult | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchStockAlertsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดการแจ้งเตือนไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">แจ้งเตือนสต็อก</h1>
          <p className="mt-1 text-sm text-muted">
            ระบบตรวจให้เองทุกครั้งที่สต็อกขยับ (สั่งซื้อ · ชำระเงิน · ยกเลิก · ปรับสต็อก) —
            รายการด้านล่างคำนวณสดจากฐานข้อมูล ไม่ใช่ข้อมูลที่ค้างไว้
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <ScanAlertsButton />
          <Link
            href="/admin/inventory"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            คลังสินค้า
          </Link>
        </div>
      </header>

      {errorMessage !== null || data === null ? (
        <div className="mt-6">
          <SectionError message={errorMessage ?? "โหลดการแจ้งเตือนไม่สำเร็จ"} />
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat
              icon={<PackageX className="size-5 text-danger" aria-hidden />}
              label="ของหมด"
              value={`${data.summary.outOfStock} รายการ`}
              hint="ขายต่อไม่ได้แล้ว"
            />
            <Stat
              icon={<AlertTriangle className="size-5 text-warning" aria-hidden />}
              label="เหลือน้อย"
              value={`${data.summary.lowStock} รายการ`}
              hint="ต่ำกว่าหรือเท่าจุดเตือน"
            />
            <Stat
              icon={<BellOff className="size-5 text-brand" aria-hidden />}
              label="ยังไม่รับทราบ"
              value={`${data.summary.unacknowledged} รายการ`}
              hint="ตัวเลขบนป้ายแจ้งเตือน"
            />
          </section>

          {/* ช่องทางแจ้งเตือน — บอกความจริงว่าอะไรใช้ได้ */}
          <section className="mt-4 rounded-[var(--radius-card)] border border-line bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Mail className="size-4 text-brand" aria-hidden />
              ช่องทางแจ้งเตือน
            </h2>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
              {data.channels.map((channel) => (
                <li key={channel.code} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 size-2 shrink-0 rounded-full",
                      channel.available ? "bg-success" : "bg-muted-light",
                    )}
                    aria-hidden
                  />
                  <span>
                    <strong className={channel.available ? "" : "text-muted"}>
                      {channel.name}
                    </strong>
                    {channel.unavailableReason !== null && (
                      <span className="block text-xs text-muted">{channel.unavailableReason}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <nav aria-label="กรองตามความรุนแรง" className="mt-6 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "severity", null)}
              aria-current={activeSeverity === null ? "true" : undefined}
              className={chipClass(activeSeverity === null)}
            >
              ทั้งหมด ({data.summary.outOfStock + data.summary.lowStock})
            </Link>
            <Link
              href={withParam(
                params,
                "severity",
                activeSeverity === "OUT_OF_STOCK" ? null : "OUT_OF_STOCK",
              )}
              aria-current={activeSeverity === "OUT_OF_STOCK" ? "true" : undefined}
              className={chipClass(activeSeverity === "OUT_OF_STOCK")}
            >
              ของหมด ({data.summary.outOfStock})
            </Link>
            <Link
              href={withParam(
                params,
                "severity",
                activeSeverity === "LOW_STOCK" ? null : "LOW_STOCK",
              )}
              aria-current={activeSeverity === "LOW_STOCK" ? "true" : undefined}
              className={chipClass(activeSeverity === "LOW_STOCK")}
            >
              เหลือน้อย ({data.summary.lowStock})
            </Link>
          </nav>

          <div className="mt-6">
            {data.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-success/30 bg-success/5 px-6 py-14 text-center">
                <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
                <p className="mt-3 font-extrabold">
                  {activeSeverity === null
                    ? "ไม่มีสินค้าที่ต้องเติมสต็อกตอนนี้"
                    : "ไม่มีรายการในกลุ่มนี้"}
                </p>
                <p className="mt-2 text-sm text-muted">
                  ทุกตัวเลือกที่เปิดขายมีของเหนือจุดเตือน — ตรวจเมื่อ{" "}
                  {formatDateTime(data.generatedAt)}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data.items.map((alert) => (
                  <AlertCard key={alert.variantId} alert={alert} />
                ))}
              </ul>
            )}
          </div>

          <p className="mt-6 text-xs text-muted">
            การตรวจตามกำหนดเวลาอัตโนมัติ (ไม่ต้องมีคนกด) จะเพิ่มใน STEP 52 พร้อมระบบงานเบื้องหลัง ·
            การส่งอีเมลจริงอยู่ใน STEP 50
          </p>
        </>
      )}
    </main>
  );
}

function AlertCard({ alert }: { alert: StockAlert }) {
  const isOut = alert.severity === "OUT_OF_STOCK";
  const variantLabel = [alert.color, alert.size].filter(Boolean).join(" · ") || alert.sku;

  return (
    <li
      className={cn(
        "rounded-[var(--radius-card)] border bg-white p-5",
        isOut ? "border-danger/30" : "border-warning/30",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
                isOut
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-warning/30 bg-warning/10 text-warning",
              )}
            >
              {isOut ? "ของหมด" : "เหลือน้อย"}
            </span>
            {alert.notification === null ? (
              <span className="text-xs text-muted">รับทราบแล้ว</span>
            ) : (
              <span className="text-xs text-muted">
                แจ้งเมื่อ {formatDateTime(alert.notification.createdAt)}
              </span>
            )}
          </div>

          <p className="mt-2 font-bold break-words">{alert.product.name}</p>
          <p className="text-xs text-muted">
            {variantLabel} · <span className="font-mono break-all">{alert.sku}</span>
          </p>
        </div>

        {alert.notification !== null && (
          <AcknowledgeButton
            notificationId={alert.notification.id}
            label={`${alert.product.name} (${variantLabel})`}
          />
        )}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">ขายได้จริง</dt>
          <dd className={cn("font-extrabold", isOut ? "text-danger" : "text-warning")}>
            {alert.available} ชิ้น
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">ในคลัง</dt>
          <dd className="font-semibold">{alert.quantity} ชิ้น</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">จองไว้</dt>
          <dd className="font-semibold">{alert.reserved} ชิ้น</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">จุดเตือน</dt>
          <dd className="font-semibold">{alert.minimumStock} ชิ้น</dd>
        </div>
      </dl>

      {alert.quantity > 0 && alert.available === 0 && (
        <p className="mt-3 rounded-[12px] border border-line bg-lilac-50 p-3 text-xs">
          ของ {alert.quantity} ชิ้นยังอยู่ในคลัง แต่ถูกจองไว้ในคำสั่งซื้อที่ยังไม่จบทั้งหมด
          จึงขายต่อไม่ได้
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/admin/inventory/${alert.variantId}`}
          className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
        >
          รับของเข้า
        </Link>
        <Link
          href={`/admin/products/${alert.product.id}`}
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          แก้ไขสินค้า / จุดเตือน
        </Link>
      </div>
    </li>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-extrabold text-brand-dark">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
  );
}
