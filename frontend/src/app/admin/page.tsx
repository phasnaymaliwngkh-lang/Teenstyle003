import {
  AlertTriangle,
  Banknote,
  Boxes,
  ClipboardList,
  PackageCheck,
  Truck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { orderStatusLabel } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { fetchAdminOverviewOnServer } from "@/services/admin.server";
import type { AdminOverview } from "@/types/admin";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "Admin Dashboard",
  robots: { index: false, follow: false },
};

/**
 * หน้า Dashboard หลังบ้าน (STEP 13)
 *
 * ⚠️ **ทุกตัวเลขมาจากฐานข้อมูลจริง** — ถ้ายังไม่มีข้อมูลจะเป็น 0 หรือรายการว่าง
 *    ไม่มีกราฟตัวอย่างหรือยอดสมมติเพื่อให้หน้าดูสวย
 * ⚠️ "ยอดขาย" นับเฉพาะเงินที่ได้รับจริง · COD ที่ยังไม่เก็บเงินแยกไว้อีกช่อง
 */
export default async function AdminDashboardPage() {
  // layout ตรวจ requireStaff แล้ว — หน้านี้ต้องมีสิทธิ์ดูรายงานเพิ่ม
  await requirePermission("analytics:read");

  let data: AdminOverview | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminOverviewOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดข้อมูลสรุปไม่สำเร็จ";
  }

  if (errorMessage !== null || data === null) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <SectionError message={errorMessage ?? "โหลดข้อมูลสรุปไม่สำเร็จ"} />
      </main>
    );
  }

  const actions = [
    {
      label: "รอชำระเงิน",
      count: data.orders.awaitingPayment,
      href: "/admin/orders?status=PENDING_PAYMENT",
      icon: <ClipboardList className="size-5 text-warning" aria-hidden />,
    },
    {
      label: "รอจัดของ",
      count: data.orders.toProcess,
      href: "/admin/orders?status=PROCESSING",
      icon: <PackageCheck className="size-5 text-brand" aria-hidden />,
    },
    {
      label: "รอส่งของ",
      count: data.orders.toShip,
      href: "/admin/orders?status=PACKING",
      icon: <Truck className="size-5 text-brand" aria-hidden />,
    },
    {
      label: "สินค้าสต็อกต่ำ",
      count: data.inventory.lowStock,
      href: "/admin/alerts",
      icon: <AlertTriangle className="size-5 text-danger" aria-hidden />,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">ภาพรวมร้าน</h1>
          <p className="mt-1 text-sm text-muted">
            ตัวเลขทั้งหมดนับจากฐานข้อมูลจริง ณ{" "}
            {new Date(data.generatedAt).toLocaleString("th-TH", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/barcodes"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            บาร์โค้ด / QR
          </Link>
          <Link
            href="/admin/inventory"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            คลังสินค้า
          </Link>
          <Link
            href="/admin/products"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            จัดการสินค้า
          </Link>
          <Link
            href="/admin/orders"
            className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
          >
            จัดการคำสั่งซื้อ
          </Link>
        </div>
      </header>

      {/* ─── งานที่ต้องทำ ─── */}
      <section className="mt-8">
        <h2 className="text-lg">งานที่ต้องทำ</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] transition hover:border-brand-soft hover:shadow-[var(--shadow-lift)]"
            >
              <div className="flex items-center justify-between gap-2">
                {action.icon}
                <span className="text-2xl font-extrabold">{action.count}</span>
              </div>
              <p className="mt-2 text-sm font-semibold">{action.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── เงิน ─── */}
      <section className="mt-8">
        <h2 className="text-lg">ยอดขาย (เฉพาะเงินที่ได้รับจริง)</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={<Banknote className="size-5 text-success" aria-hidden />}
            label="รวมทั้งหมด"
            value={formatBaht(data.revenue.total)}
            hint={`${data.revenue.paidOrders} ออเดอร์ที่ชำระแล้ว`}
          />
          <Stat
            icon={<Banknote className="size-5 text-success" aria-hidden />}
            label="30 วันล่าสุด"
            value={formatBaht(data.revenue.last30Days)}
            hint={`7 วันล่าสุด ${formatBaht(data.revenue.last7Days)}`}
          />
          <Stat
            icon={<Banknote className="size-5 text-brand" aria-hidden />}
            label="ยอดเฉลี่ยต่อออเดอร์"
            value={formatBaht(data.revenue.averageOrderValue)}
          />
          <Stat
            icon={<Truck className="size-5 text-warning" aria-hidden />}
            label="รอเก็บเงินปลายทาง"
            value={formatBaht(data.revenue.pendingCodAmount)}
            hint="ยังไม่นับเป็นรายได้"
          />
        </div>
      </section>

      {/* ─── ของและคน ─── */}
      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <Boxes className="size-5 text-brand" aria-hidden />
            สินค้าและคลัง
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="สินค้าทั้งหมด" value={`${data.products.total} รายการ`} />
            <Row label="เปิดขายอยู่" value={`${data.products.active} รายการ`} />
            <Row label="ตัวเลือก (variant)" value={`${data.products.variants} รายการ`} />
            <Row label="ของหมด" value={`${data.products.outOfStock} รายการ`} />
            <Row label="สต็อกต่ำกว่าจุดเตือน" value={`${data.inventory.lowStock} รายการ`} />
            <Row
              label="จำนวนชิ้นในคลัง"
              value={`${data.inventory.totalUnits.toLocaleString("th-TH")} ชิ้น (จองไว้ ${data.inventory.reservedUnits})`}
            />
          </dl>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <Users className="size-5 text-brand" aria-hidden />
            ลูกค้าและคำสั่งซื้อ
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="ผู้ใช้ทั้งหมด" value={`${data.customers.total} คน`} />
            <Row label="สมัครใหม่ 30 วัน" value={`${data.customers.newLast30Days} คน`} />
            <Row label="คำสั่งซื้อทั้งหมด" value={`${data.orders.total} ออเดอร์`} />
            <Row label="คำสั่งซื้อ 30 วัน" value={`${data.orders.last30Days} ออเดอร์`} />
          </dl>

          {data.orders.byStatus.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              {data.orders.byStatus.map((entry) => (
                <li key={entry.status}>
                  <Link
                    href={`/admin/orders?status=${entry.status}`}
                    className="flex min-h-9 items-center rounded-[var(--radius-pill)] border border-line px-3 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                  >
                    {orderStatusLabel(entry.status)} ({entry.count})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ─── สินค้าขายดี (ว่างได้ตามจริง) ─── */}
      <section className="mt-8">
        <h2 className="text-lg">สินค้าขายดี</h2>
        <p className="mt-1 text-sm text-muted">
          นับจากคำสั่งซื้อที่ชำระเงินแล้วเท่านั้น — ยังไม่รวมออเดอร์ที่รอเก็บเงินปลายทาง
        </p>

        {data.topProducts.length === 0 ? (
          <div className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-6 text-center text-sm text-muted">
            ยังไม่มีคำสั่งซื้อที่ชำระเงินแล้ว จึงยังไม่มีอันดับขายดี
          </div>
        ) : (
          <ol className="mt-3 space-y-2">
            {data.topProducts.map((product, index) => (
              <li
                key={product.productId}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lilac text-sm font-bold text-brand-dark">
                  {index + 1}
                </span>
                <Link
                  href={`/product/${product.slug}`}
                  className="min-w-0 flex-1 truncate text-sm font-bold transition hover:text-brand"
                >
                  {product.name}
                </Link>
                <span className="shrink-0 text-sm text-muted">{product.quantity} ชิ้น</span>
                <span className="shrink-0 text-sm font-extrabold text-brand-dark">
                  {formatBaht(product.revenue)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">
        บาร์โค้ด/QR (STEP 17) · นำเข้า-ส่งออก CSV (STEP 18) · รายงานเชิงลึกและกราฟ (STEP 26) ·
        ประวัติการแก้ไขของแอดมิน (STEP 27) จะเพิ่มในลำดับถัดไป
      </p>
    </main>
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
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-extrabold text-brand-dark">{value}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="shrink-0 font-semibold">{value}</dd>
    </div>
  );
}
