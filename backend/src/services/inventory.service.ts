import type { Prisma } from '@teenstyle/database';

import { ApiError } from '../utils/api-error.ts';

/**
 * การเดินสต็อกที่ผูกกับคำสั่งซื้อ (STEP 11 · STEP 15 จะขยายเป็นระบบคลังเต็มรูปแบบ)
 *
 * วงจรของสต็อกในระบบนี้
 *   1. STEP 10 สั่งซื้อ  → `reservedQuantity += q`      (จองไว้ ยังไม่ตัด)
 *   2. STEP 11 จ่ายเงิน  → `quantity -= q`, `reserved -= q` + บันทึก InventoryMovement (ตัดจริง)
 *   3. ยกเลิก/หมดอายุ    → `reserved -= q`               (คืนของเข้าคลัง)
 *
 * กฎที่ห้ามละเมิด
 *   - **ห้ามตัดสต็อกซ้ำ**: ใช้ `InventoryMovement.idempotencyKey = order:<id>:deduct:<variantId>`
 *     ซึ่ง unique ที่ฐานข้อมูล — ถ้ามีอยู่แล้วจะข้ามรายการนั้นไป
 *   - **ห้ามติดลบ**: ทุก UPDATE มีเงื่อนไขในตัวเอง (`WHERE quantity >= q`) + CHECK constraint
 *   - ทุกฟังก์ชันต้องถูกเรียก **ในทรานแซกชัน** ที่ทำงานร่วมกับการเปลี่ยนสถานะออเดอร์
 */

export interface OrderStockLine {
  variantId: string | null;
  quantity: number;
  productName: string;
}

/**
 * ตัดสต็อกจริงของคำสั่งซื้อ (เรียกเมื่อชำระเงินสำเร็จ หรือเมื่อยืนยันส่งของแบบ COD)
 *
 * คืนจำนวนรายการที่ตัดจริงในครั้งนี้ (0 = เคยตัดไปแล้วทั้งหมด → ปลอดภัยต่อการเรียกซ้ำ)
 */
export async function deductStockForOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; orderNumber: string; items: OrderStockLine[] },
  actorUserId: string | null,
  reason: string,
): Promise<number> {
  let deducted = 0;

  for (const line of order.items) {
    if (line.variantId === null) continue;

    const key = `order:${order.id}:deduct:${line.variantId}`;

    // เคยตัดรายการนี้ไปแล้ว → ข้าม (กันการตัดซ้ำจาก webhook ที่ยิงหลายครั้ง)
    const existing = await tx.inventoryMovement.findUnique({
      where: { idempotencyKey: key },
      select: { id: true },
    });
    if (existing) continue;

    const inventory = await tx.inventory.findUnique({
      where: { variantId: line.variantId },
      select: { quantity: true, reservedQuantity: true },
    });

    if (!inventory) {
      throw ApiError.conflict(`ไม่พบข้อมูลคลังของสินค้า "${line.productName}"`);
    }

    /**
     * ตัดของจริงและปล่อยการจองพร้อมกันในคำสั่งเดียว (atomic)
     * เงื่อนไขในตัวคำสั่งกันไม่ให้ค่าติดลบแม้มีคนแก้ค่าพร้อมกัน
     */
    const updated = await tx.$executeRaw`
      UPDATE "Inventory"
         SET "quantity" = "quantity" - ${line.quantity},
             "reservedQuantity" = GREATEST("reservedQuantity" - ${line.quantity}, 0)
       WHERE "variantId" = ${line.variantId}::uuid
         AND "quantity" >= ${line.quantity}
    `;

    if (updated === 0) {
      throw ApiError.conflict(
        `สต็อกของ "${line.productName}" ไม่พอสำหรับตัดจ่าย (มี ${inventory.quantity} ชิ้น)`,
      );
    }

    // audit trail: บันทึกว่าตัดเมื่อไร เพราะอะไร จากออเดอร์ไหน
    await tx.inventoryMovement.create({
      data: {
        variantId: line.variantId,
        type: 'STOCK_OUT',
        quantity: line.quantity,
        quantityBefore: inventory.quantity,
        quantityAfter: inventory.quantity - line.quantity,
        reason,
        referenceType: 'ORDER',
        referenceId: order.id,
        idempotencyKey: key,
        userId: actorUserId,
      },
    });

    // cache ของผลรวมสต็อกต่อสินค้า — ต้องอัปเดตในทรานแซกชันเดียวกับต้นทาง
    const variant = await tx.productVariant.findUnique({
      where: { id: line.variantId },
      select: { productId: true },
    });

    if (variant) {
      await tx.product.update({
        where: { id: variant.productId },
        data: { totalStock: { decrement: line.quantity } },
      });
    }

    deducted += 1;
  }

  return deducted;
}

/**
 * รับของกลับเข้าคลัง (เรียกเมื่อยกเลิกออเดอร์ที่ **ตัดสต็อกไปแล้ว** — STEP 13)
 *
 * ปลอดภัยต่อการเรียกซ้ำด้วย `order:<id>:restock:<variantId>` (unique)
 * และจะรับคืนเฉพาะรายการที่ "เคยถูกตัดไปจริง" (ต้องมี movement STOCK_OUT ของออเดอร์นั้น)
 * → กันการเพิ่มสต็อกลอย ๆ จากออเดอร์ที่ยังไม่เคยตัด
 */
export async function restockForOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; orderNumber: string; items: OrderStockLine[] },
  actorUserId: string | null,
  reason: string,
): Promise<number> {
  let restocked = 0;

  for (const line of order.items) {
    if (line.variantId === null) continue;

    const key = `order:${order.id}:restock:${line.variantId}`;

    const [already, deducted] = await Promise.all([
      tx.inventoryMovement.findUnique({ where: { idempotencyKey: key }, select: { id: true } }),
      tx.inventoryMovement.findUnique({
        where: { idempotencyKey: `order:${order.id}:deduct:${line.variantId}` },
        select: { id: true },
      }),
    ]);

    // เคยรับคืนแล้ว หรือไม่เคยตัดออกไป → ไม่ต้องทำอะไร
    if (already || !deducted) continue;

    const inventory = await tx.inventory.findUnique({
      where: { variantId: line.variantId },
      select: { quantity: true },
    });

    if (!inventory) {
      throw ApiError.conflict(`ไม่พบข้อมูลคลังของสินค้า "${line.productName}"`);
    }

    await tx.inventory.update({
      where: { variantId: line.variantId },
      data: { quantity: { increment: line.quantity } },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: line.variantId,
        type: 'RETURN',
        quantity: line.quantity,
        quantityBefore: inventory.quantity,
        quantityAfter: inventory.quantity + line.quantity,
        reason,
        referenceType: 'ORDER',
        referenceId: order.id,
        idempotencyKey: key,
        userId: actorUserId,
      },
    });

    const variant = await tx.productVariant.findUnique({
      where: { id: line.variantId },
      select: { productId: true },
    });

    if (variant) {
      await tx.product.update({
        where: { id: variant.productId },
        data: { totalStock: { increment: line.quantity } },
      });
    }

    restocked += 1;
  }

  return restocked;
}

/**
 * คืนของที่จองไว้เข้าคลัง (เรียกเมื่อยกเลิกคำสั่งซื้อ หรือคำสั่งซื้อหมดอายุ)
 *
 * ปลอดภัยต่อการเรียกซ้ำ: ใช้ `GREATEST(... , 0)` จึงไม่ทำให้ค่าติดลบ
 * ⚠️ ห้ามเรียกกับออเดอร์ที่ตัดสต็อกไปแล้ว (จ่ายเงินแล้ว) — ของถูกตัดออกไปจริงแล้ว
 */
export async function releaseReservationForOrder(
  tx: Prisma.TransactionClient,
  order: { items: OrderStockLine[] },
): Promise<void> {
  for (const line of order.items) {
    if (line.variantId === null) continue;

    await tx.$executeRaw`
      UPDATE "Inventory"
         SET "reservedQuantity" = GREATEST("reservedQuantity" - ${line.quantity}, 0)
       WHERE "variantId" = ${line.variantId}::uuid
    `;
  }
}
