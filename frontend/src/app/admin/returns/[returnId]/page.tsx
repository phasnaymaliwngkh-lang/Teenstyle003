import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReturnActions } from "@/features/admin/components/return-actions";
import { formatDateTime } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchAdminReturnOnServer } from "@/services/returns.server";
import { RETURN_STATUS_TONE, type AdminReturnRequest } from "@/types/returns";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "คำขอคืนสินค้า",
  robots: { index: false, follow: false },
};

/**
 * คำขอคืนสินค้ารายการเดียว /admin/returns/[returnId] (STEP 43 · `order:read`)
 *
 * ⚠️ `await` ข้อมูลหลักที่ระดับ page และ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้** (soft 404)
 * ⚠️ ปุ่มแต่ละขั้นขึ้นตามสิทธิ์และสถานะที่ server บอก — ด่านจริงอยู่ที่ backend
 */
export default async function AdminReturnPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const session = await requirePermission("order:read");
  const { returnId } = await params;

  let request: AdminReturnRequest;

  try {
    request = await fetchAdminReturnOnServer(returnId);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    throw error;
  }

  const permissions = session.user.permissions;
  const timeline = [
    { label: "ลูกค้ายื่นคำขอ", at: request.createdAt },
    { label: "อนุมัติ", at: request.approvedAt },
    { label: "ตรวจรับของ", at: request.receivedAt },
    { label: "คืนเงิน", at: request.refundedAt },
    { label: "ไม่รับคืน", at: request.rejectedAt },
    { label: "ลูกค้ายกเลิก", at: request.cancelledAt },
  ].filter((step) => step.at !== null);

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/returns"
        className="text-sm font-semibold text-brand underline hover:text-brand-dark"
      >
        ← กลับไปคิวคืนสินค้า
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl break-words sm:text-3xl">{request.returnNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            คำสั่งซื้อ{" "}
            <Link
              href={`/admin/orders/${encodeURIComponent(request.orderNumber)}`}
              className="font-semibold text-brand underline"
            >
              {request.orderNumber}
            </Link>{" "}
            · ยอดที่จ่าย {formatBaht(request.orderTotal)} · คืนไปแล้วทั้งบิล{" "}
            {formatBaht(request.orderRefundedTotal)}
          </p>
          <p className="mt-1 text-sm break-all text-muted">
            ลูกค้า:{" "}
            <Link
              href={`/admin/customers/${request.customer.id}`}
              className="font-semibold text-brand underline"
            >
              {request.customer.name ?? request.customer.email}
            </Link>{" "}
            · {request.customer.email} · จ่ายด้วย {request.paidWith ?? "ไม่ทราบ"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-bold",
            RETURN_STATUS_TONE[request.status],
          )}
        >
          {request.statusLabel}
        </span>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4 rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="text-lg">{request.reasonLabel}</h2>
          <p className="rounded-[12px] bg-lilac-50 p-3 text-sm break-words">{request.detail}</p>

          <ul className="divide-y divide-line text-sm">
            {request.items.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 break-words">
                  {item.productName}
                  <span className="text-muted">
                    {" "}
                    {[item.colorName, item.sizeName].filter(Boolean).join(" · ")} ·{" "}
                    {item.variantSku}
                  </span>
                </span>
                <span className="shrink-0">
                  {formatBaht(item.unitPrice)} × {item.quantity}
                  {request.receivedAt !== null && (
                    <span className="ml-2 text-xs text-muted">
                      {item.restocked ? "รับเข้าคลังแล้ว" : "ไม่รับเข้าคลัง"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {request.staffNote !== null && (
            <p className="text-sm break-words">
              <span className="font-semibold">ข้อความถึงลูกค้า:</span> {request.staffNote}
            </p>
          )}

          <dl className="space-y-1 border-t border-line pt-3 text-sm">
            {request.refund !== null ? (
              <>
                <Row label="คืนเงินแล้ว" value={formatBaht(request.refund.amount)} />
                <Row label="วิธี" value={request.refund.methodLabel} />
                <Row label="เลขอ้างอิง" value={request.refund.reference} />
                <Row
                  label="บันทึกโดย"
                  value={
                    request.refundRecordedBy === null
                      ? "(บัญชีถูกลบแล้ว)"
                      : (request.refundRecordedBy.name ?? request.refundRecordedBy.email)
                  }
                />
              </>
            ) : (
              request.estimatedRefund !== null && (
                <Row
                  label="ยอดที่ต้องคืน (คำนวณจากที่จ่ายจริง)"
                  value={formatBaht(request.estimatedRefund)}
                />
              )
            )}
          </dl>

          <ol className="space-y-1 border-t border-line pt-3 text-xs text-muted">
            {timeline.map((step) => (
              <li key={step.label}>
                {step.label} · {formatDateTime(step.at!)}
              </li>
            ))}
          </ol>
        </section>

        <aside className="rounded-[var(--radius-card)] border border-line bg-white p-5 lg:self-start">
          <h2 className="text-lg">ขั้นถัดไป</h2>
          <div className="mt-3">
            <ReturnActions
              request={request}
              canUpdate={permissions.includes("order:update")}
              canRefund={permissions.includes("order:refund")}
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold break-all">{value}</dd>
    </div>
  );
}
