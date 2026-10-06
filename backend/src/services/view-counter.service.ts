import { getPrisma } from '@teenstyle/database';

import { logger } from '../utils/logger.ts';

/**
 * ยอดเข้าชมสินค้า — รวมเป็นชุดก่อนเขียน (STEP 46)
 *
 * เดิมเปิดหน้าสินค้าหนึ่งครั้ง = `UPDATE "Product" … viewCount + 1` หนึ่งครั้งในเส้นทางอ่าน
 * (4.5ms + row lock ต่อการเปิดหน้า — วัดไว้ตอน STEP 34) และเพราะเขียนผ่าน `prisma.product.update`
 * **`updatedAt` ของสินค้าขยับทุกครั้งที่ลูกค้าเปิดดู** — หลังบ้านเรียงรายการสินค้าตาม `updatedAt`
 * จึงเรียงตาม "ลูกค้าเปิดดูล่าสุด" แทน "แก้ไขล่าสุด" (เจอในข้อมูลจริงตอน STEP 46)
 *
 * ตอนนี้: นับในหน่วยความจำ → เขียนครั้งเดียวต่อ {@link FLUSH_DELAY_MS} ด้วย SQL ตรง (ไม่แตะ `updatedAt`)
 *
 * ⚠️ **ยอดที่ยังไม่ถูกเขียนหายได้** ถ้า process ตายกะทันหัน (ไม่เกิน {@link FLUSH_DELAY_MS}) —
 *    ยอมรับได้เพราะยอดเข้าชมเป็นสัญญาณความนิยมโดยประมาณ ไม่ใช่เงินหรือสต็อก · ปิดแบบปกติจะเขียนก่อนปิด
 *    (`server.ts` เรียก {@link flushProductViews}) · หลาย instance ก็ถูกต้อง เพราะทุกชุดเป็นการ "บวกเพิ่ม"
 */
export const FLUSH_DELAY_MS = 5_000;

const pending = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function recordProductView(productId: string): void {
  pending.set(productId, (pending.get(productId) ?? 0) + 1);

  if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      void flushProductViews();
    }, FLUSH_DELAY_MS);
    // ไม่ให้ตัวจับเวลานี้ค้าง process ไว้ (เทสต์และการปิด server ต้องจบได้)
    timer.unref();
  }
}

/** เขียนยอดที่ค้างทั้งหมดในคิวรีเดียว — คืนจำนวนการเข้าชมที่เขียนได้ */
export async function flushProductViews(): Promise<number> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  if (pending.size === 0) return 0;

  const batch = [...pending.entries()];
  pending.clear();

  const ids = batch.map(([id]) => id);
  const counts = batch.map(([, count]) => count);

  try {
    await getPrisma().$executeRaw`
      UPDATE "Product" p
         SET "viewCount" = p."viewCount" + v.n
        FROM unnest(${ids}::uuid[], ${counts}::int[]) AS v(id, n)
       WHERE p.id = v.id`;
  } catch (error) {
    // การนับยอดล้มต้องไม่ทำให้การเปิดหน้าสินค้าล้ม (แพตเทิร์นเดียวกับ notifySafely ของ STEP 24)
    logger.warn(
      { err: error, products: batch.length },
      'บันทึกยอดเข้าชมสินค้าไม่สำเร็จ — ยอดชุดนี้หายไป',
    );
    return 0;
  }

  return counts.reduce((sum, count) => sum + count, 0);
}
