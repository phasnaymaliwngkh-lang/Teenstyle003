import { Prisma } from '@teenstyle/database';

import { ApiError } from '../utils/api-error.ts';

/**
 * ด่านเดียวของ "สินค้าใช้ได้เฉพาะหมวด/แบรนด์/สี/ไซซ์ที่เปิดใช้อยู่" (STEP 48)
 *
 * เรียกในทรานแซกชันทุกครั้งที่ผูกของเหล่านี้กับสินค้า: สร้าง/แก้สินค้า · เพิ่มตัวเลือก ·
 * เปิดตัวเลือกกลับมา · เปิดขายสินค้า · นำเข้าจากไฟล์
 *
 * ⚠️ ล็อกแถวแบบ `FOR SHARE` คู่กับ `FOR UPDATE` ของ catalog-admin.service ตอนปิดใช้งาน/ลบ
 *    ถ้าแค่อ่านค่า `isActive` ธรรมดา คนหนึ่งปิดหมวดขณะอีกคนเปิดขายสินค้าในหมวดนั้น
 *    ทั้งคู่ผ่านการตรวจได้ (READ COMMITTED เห็นค่าเดิมทั้งคู่) แล้วได้สินค้าที่ขายอยู่ในหมวดที่ปิด
 *    ล็อกแล้วฝั่งที่มาทีหลังต้องรอ และเห็นผลของฝั่งแรกก่อนตัดสิน
 */

export interface CatalogRefs {
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
  colorIds?: ReadonlyArray<string | null> | undefined;
  sizeIds?: ReadonlyArray<string | null> | undefined;
}

type TableName = 'Category' | 'Brand' | 'Color' | 'Size';

const TABLES: Record<TableName, { label: string; softDelete: boolean }> = {
  Category: { label: 'หมวดหมู่', softDelete: true },
  Brand: { label: 'แบรนด์', softDelete: true },
  Color: { label: 'สี', softDelete: false },
  Size: { label: 'ไซซ์', softDelete: false },
};

async function lockAndCheck(
  tx: Prisma.TransactionClient,
  table: TableName,
  ids: readonly string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;

  const meta = TABLES[table];
  const deletedColumn = meta.softDelete ? Prisma.sql`"deletedAt" IS NOT NULL` : Prisma.sql`false`;

  // ชื่อตารางมาจาก whitelist ด้านบนเท่านั้น — ไม่มีส่วนไหนมาจากผู้ใช้
  const rows = await tx.$queryRaw<
    Array<{ id: string; name: string; isActive: boolean; deleted: boolean }>
  >(
    Prisma.sql`
      SELECT "id", "name", "isActive", ${deletedColumn} AS "deleted"
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE "id" = ANY(${unique}::uuid[])
      FOR SHARE
    `,
  );

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of unique) {
    const row = byId.get(id);

    if (row === undefined || row.deleted) {
      throw ApiError.badRequest(
        `ไม่พบ${meta.label}นี้แล้ว (อาจถูกลบไปแล้ว) — โหลดหน้าใหม่แล้วเลือกอีกครั้ง`,
      );
    }

    if (!row.isActive) {
      throw ApiError.badRequest(
        `${meta.label} "${row.name}" ปิดใช้งานอยู่ — เปิดที่หน้าหมวดหมู่และตัวเลือกสินค้าก่อน หรือเลือก${meta.label}อื่น`,
      );
    }
  }
}

const present = (values: ReadonlyArray<string | null> | undefined): string[] =>
  (values ?? []).filter((value): value is string => value !== null);

export async function assertCatalogRefsActive(
  tx: Prisma.TransactionClient,
  refs: CatalogRefs,
): Promise<void> {
  // ลำดับการล็อกคงที่ (หมวด → แบรนด์ → สี → ไซซ์) เหมือนกันทุกที่ ลดโอกาส deadlock
  await lockAndCheck(tx, 'Category', refs.categoryId ? [refs.categoryId] : []);
  await lockAndCheck(tx, 'Brand', refs.brandId ? [refs.brandId] : []);
  await lockAndCheck(tx, 'Color', present(refs.colorIds));
  await lockAndCheck(tx, 'Size', present(refs.sizeIds));
}
