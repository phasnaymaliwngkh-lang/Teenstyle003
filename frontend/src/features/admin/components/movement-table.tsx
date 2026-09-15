import Link from "next/link";

import { deltaTone, formatDelta, movementLabel, movementSource } from "../lib/inventory-labels";

import { formatDateTime } from "@/features/orders/lib/labels";
import { cn } from "@/lib/utils";
import type { InventoryMovement } from "@/types/admin";

/**
 * ตารางประวัติการเคลื่อนไหวของสต็อก (STEP 15)
 *
 * ⚠️ แสดง "ก่อน → หลัง" ของทุกแถว เพราะนั่นคือสิ่งที่ทำให้ประวัติตรวจสอบได้จริง
 *    (after ของแถวก่อนต้องเท่ากับ before ของแถวถัดไป — ถ้าไม่ตรงคือมีคนเขียนคลังนอกระบบ)
 * ⚠️ `actor = null` หมายถึงระบบทำเอง (ตัดสต็อกตอนชำระเงินสำเร็จ) ต้องบอกตามจริง
 *    ห้ามใส่ชื่อคนมั่ว
 */
export function MovementTable({
  movements,
  showProduct = true,
}: {
  movements: InventoryMovement[];
  showProduct?: boolean;
}) {
  if (movements.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-6 text-center text-sm text-muted">
        ยังไม่มีการเคลื่อนไหวของสต็อกตามเงื่อนไขนี้
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted uppercase">
            <th scope="col" className="py-2 pr-3 font-bold">
              เมื่อไร
            </th>
            {showProduct && (
              <th scope="col" className="py-2 pr-3 font-bold">
                สินค้า / SKU
              </th>
            )}
            <th scope="col" className="py-2 pr-3 font-bold">
              รายการ
            </th>
            <th scope="col" className="py-2 pr-3 font-bold">
              เปลี่ยน
            </th>
            <th scope="col" className="py-2 pr-3 font-bold">
              ก่อน → หลัง
            </th>
            <th scope="col" className="py-2 pr-3 font-bold">
              เหตุผล
            </th>
            <th scope="col" className="py-2 font-bold">
              ใครทำ
            </th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id} className="border-b border-line/60 align-top">
              <td className="py-3 pr-3 text-xs whitespace-nowrap text-muted">
                {formatDateTime(movement.createdAt)}
              </td>

              {showProduct && (
                <td className="py-3 pr-3">
                  <Link
                    href={`/admin/inventory/${movement.variant.id}`}
                    className="font-semibold text-brand underline"
                  >
                    {movement.variant.productName}
                  </Link>
                  <span className="block font-mono text-xs break-all text-muted">
                    {movement.variant.sku}
                  </span>
                </td>
              )}

              <td className="py-3 pr-3">
                <span className="font-semibold">{movementLabel(movement.type)}</span>
                <span className="block text-xs text-muted">
                  {movementSource(movement.referenceType)}
                </span>
              </td>

              <td className={cn("py-3 pr-3 font-extrabold", deltaTone(movement.delta))}>
                {formatDelta(movement.delta)}
              </td>

              <td className="py-3 pr-3 text-xs whitespace-nowrap">
                {movement.quantityBefore} → <strong>{movement.quantityAfter}</strong>
              </td>

              <td className="py-3 pr-3 text-xs break-words">{movement.reason}</td>

              <td className="py-3 text-xs break-all text-muted">
                {movement.actor === null ? (
                  <span title="รายการที่ระบบทำเอง เช่น ตัดสต็อกตอนชำระเงินสำเร็จ">ระบบ</span>
                ) : (
                  (movement.actor.name ?? movement.actor.email)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
