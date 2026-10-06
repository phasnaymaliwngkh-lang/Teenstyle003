import Link from "next/link";

import { formatDateTime } from "@/features/orders/lib/labels";
import { cn } from "@/lib/utils";
import { RETURN_STATUS_TONE, type ReturnRequest } from "@/types/returns";
import { formatBaht } from "@/utils/format";

import { CancelReturnButton } from "./cancel-return-button";

/**
 * คำขอคืนสินค้าหนึ่งรายการ (STEP 43) — ใช้ในหน้า "คำขอคืนสินค้า" และหน้ารายละเอียดคำสั่งซื้อ
 *
 * ทุกตัวเลขมาจาก server · ไทม์ไลน์แสดงเฉพาะเวลาที่เกิดขึ้นจริง (กฎ STEP 12 ข้อ 1)
 */
export function ReturnRequestCard({
  request,
  showOrderLink = true,
}: {
  request: ReturnRequest;
  showOrderLink?: boolean;
}) {
  const steps: { label: string; at: string | null }[] = [
    { label: "ส่งคำขอ", at: request.createdAt },
    { label: "ร้านอนุมัติ", at: request.approvedAt },
    { label: "ร้านได้รับของ", at: request.receivedAt },
    { label: "คืนเงินแล้ว", at: request.refundedAt },
    { label: "ร้านไม่รับคืน", at: request.rejectedAt },
    { label: "ยกเลิกคำขอ", at: request.cancelledAt },
  ].filter((step) => step.at !== null);

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-extrabold break-words">{request.returnNumber}</h3>
          <p className="text-xs text-muted">
            {request.reasonLabel}
            {showOrderLink && (
              <>
                {" · "}
                <Link
                  href={`/account/orders/${encodeURIComponent(request.orderNumber)}`}
                  className="underline"
                >
                  คำสั่งซื้อ {request.orderNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-bold",
            RETURN_STATUS_TONE[request.status],
          )}
        >
          {request.statusLabel}
        </span>
      </header>

      <ul className="mt-3 space-y-1 text-sm">
        {request.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">
              {item.productName}
              <span className="text-muted">
                {" "}
                {[item.colorName, item.sizeName].filter(Boolean).join(" · ")} × {item.quantity}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 rounded-[12px] bg-lilac-50 p-3 text-sm break-words text-ink-soft">
        {request.detail}
      </p>

      {request.staffNote !== null && (
        <p className="mt-3 text-sm break-words">
          <span className="font-semibold">ข้อความจากร้าน:</span> {request.staffNote}
        </p>
      )}

      <dl className="mt-3 space-y-1 text-sm">
        {request.refund !== null ? (
          <>
            <Row label="คืนเงินแล้ว" value={formatBaht(request.refund.amount)} strong />
            <Row label="วิธีคืนเงิน" value={request.refund.methodLabel} />
            <Row label="เลขอ้างอิง" value={request.refund.reference} />
          </>
        ) : (
          request.estimatedRefund !== null && (
            <Row label="ยอดที่จะได้คืน" value={formatBaht(request.estimatedRefund)} strong />
          )
        )}
      </dl>

      <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {steps.map((step) => (
          <li key={step.label}>
            {step.label} {formatDateTime(step.at!)}
          </li>
        ))}
      </ol>

      {request.status === "APPROVED" && (
        <p className="mt-3 text-xs font-semibold text-brand-dark">
          ส่งสินค้ากลับมาที่ร้านได้เลย — ร้านจะคืนเงินหลังตรวจรับของแล้ว
        </p>
      )}

      {request.canCancel && (
        <div className="mt-4">
          <CancelReturnButton returnId={request.id} returnNumber={request.returnNumber} />
        </div>
      )}
    </article>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("text-right break-all", strong && "font-extrabold text-brand-dark")}>
        {value}
      </dd>
    </div>
  );
}
