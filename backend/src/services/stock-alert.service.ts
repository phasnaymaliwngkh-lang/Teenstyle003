import { getPrisma, Prisma } from '@teenstyle/database';

import { isEmailConfigured, notificationChannels } from '../config/notification.ts';
import { ApiError } from '../utils/api-error.ts';
import { logger } from '../utils/logger.ts';

/**
 * การแจ้งเตือนสต็อก (STEP 16)
 *
 * แนวคิดหลัก — แยก "สถานะ" ออกจาก "การแจ้ง"
 *   1. **สถานะเตือนคำนวณสดจากฐานข้อมูลทุกครั้ง** (`available <= minimumStock`)
 *      จึงไม่มีทางค้างหรือขัดกับความจริง · ของกลับมาเต็ม = หายจากรายการทันที
 *   2. **แถว `Notification` ทำหน้าที่เดียว: จำว่า "เคยบอกร้านไปแล้ว"**
 *      เพื่อไม่ยิงซ้ำทุกครั้งที่มีคนสั่งซื้อ (alert deduplication แบบระบบ monitoring)
 *
 * กฎที่ห้ามละเมิด
 *   - **เตือนเฉพาะของที่ขายอยู่จริง** (สินค้า ACTIVE + ตัวเลือกเปิดขาย) ไม่งั้นแอดมินจะจม
 *     ไปกับการเตือนของฉบับร่างและของที่เลิกขายแล้ว แล้วเลิกอ่านการแจ้งเตือนทั้งหมด
 *   - **ใช้จำนวนที่ขายได้จริง** (`quantity − reserved`) ไม่ใช่ `Product.totalStock`
 *     → ของที่ถูกจองจนหมดต้องเตือน เพราะขายต่อไม่ได้แล้วจริง ๆ
 *   - **แย่ลงต้องเตือนใหม่ · ดีขึ้นไม่ต้องเตือน** (LOW → หมด = เตือนใหม่ · หมด → LOW = ไม่เตือน)
 *   - **ห้ามสร้างแถวแจ้งเตือนของช่องทางที่ส่งไม่ได้จริง** (ดู [config/notification.ts](../config/notification.ts))
 *   - ตัวเลขทุกตัวในข้อความแจ้งเตือนมาจากฐานข้อมูล **ห้ามปัดหรือเดา**
 */

export type AlertSeverity = 'LOW_STOCK' | 'OUT_OF_STOCK';

/** ยิ่งเลขมากยิ่งแย่ — ใช้ตัดสินว่าต้องเตือนใหม่ไหม */
const SEVERITY_RANK: Record<AlertSeverity, number> = { LOW_STOCK: 1, OUT_OF_STOCK: 2 };

export interface StockAlertDto {
  variantId: string;
  sku: string;
  severity: AlertSeverity;
  quantity: number;
  reserved: number;
  available: number;
  minimumStock: number;
  color: string | null;
  size: string | null;
  product: { id: string; name: string; slug: string };
  /** การแจ้งเตือนที่ยังเปิดอยู่ (ยังไม่มีใครรับทราบ) — null = ยังไม่ได้แจ้ง */
  notification: { id: string; createdAt: string } | null;
}

interface AlertRow {
  variantId: string;
  sku: string;
  quantity: number;
  reserved: number;
  available: number;
  minimumStock: number;
  colorName: string | null;
  sizeName: string | null;
  productId: string;
  productName: string;
  productSlug: string;
}

/**
 * หาของที่เข้าเกณฑ์เตือนในตอนนี้
 *
 * เงื่อนไข "ขายอยู่จริง" = สินค้ายังไม่ถูกลบและสถานะ ACTIVE + ตัวเลือกยังไม่ถูกลบและเปิดขาย
 * เรียงของหมดขึ้นก่อน แล้วค่อยเรียงตามจำนวนที่เหลือ
 */
async function findAlertRows(variantIds?: string[]): Promise<AlertRow[]> {
  const prisma = getPrisma();
  const scope =
    variantIds === undefined
      ? Prisma.empty
      : Prisma.sql`AND v."id" IN (${Prisma.join(variantIds)})`;

  return prisma.$queryRaw<AlertRow[]>(Prisma.sql`
    SELECT v."id"                    AS "variantId",
           v."sku"                   AS "sku",
           i."quantity"              AS "quantity",
           i."reservedQuantity"      AS "reserved",
           GREATEST(i."quantity" - i."reservedQuantity", 0) AS "available",
           p."minimumStock"          AS "minimumStock",
           c."name"                  AS "colorName",
           s."name"                  AS "sizeName",
           p."id"                    AS "productId",
           p."name"                  AS "productName",
           p."slug"                  AS "productSlug"
    FROM "ProductVariant" v
    JOIN "Product" p   ON p."id" = v."productId"
    JOIN "Inventory" i ON i."variantId" = v."id"
    LEFT JOIN "Color" c ON c."id" = v."colorId"
    LEFT JOIN "Size" s  ON s."id" = v."sizeId"
    WHERE v."deletedAt" IS NULL
      AND v."isActive"
      AND p."deletedAt" IS NULL
      AND p."status" = 'ACTIVE'
      AND GREATEST(i."quantity" - i."reservedQuantity", 0) <= p."minimumStock"
      ${scope}
    ORDER BY GREATEST(i."quantity" - i."reservedQuantity", 0) ASC, p."name" ASC
  `);
}

function severityOf(row: AlertRow): AlertSeverity {
  return row.available <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK';
}

function variantLabel(row: AlertRow): string {
  const parts = [row.colorName, row.sizeName].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : row.sku;
}

/** ข้อมูลที่เก็บใน `Notification.data` — ใช้จับคู่การแจ้งเตือนกับตัวเลือกสินค้า */
interface AlertPayload {
  variantId: string;
  productId: string;
  productSlug: string;
  sku: string;
  severity: AlertSeverity;
  available: number;
  minimumStock: number;
  /** ใครเป็นคนปิดรายการนี้ — 'system' = ของกลับมาปกติ/ถูกแทนด้วยระดับที่แย่กว่า */
  closedBy?: 'system' | 'staff';
  closedReason?: string;
}

function readPayload(data: Prisma.JsonValue | null): AlertPayload | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  const record = data as Record<string, unknown>;
  if (typeof record['variantId'] !== 'string') return null;

  return record as unknown as AlertPayload;
}

/** การแจ้งเตือนสต็อกที่ยังเปิดอยู่ทั้งหมด (ยังไม่มีใครรับทราบ) */
async function findOpenNotifications() {
  return getPrisma().notification.findMany({
    where: { type: 'LOW_STOCK', channel: 'IN_APP', readAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, data: true, createdAt: true },
  });
}

export interface ScanResult {
  /** แจ้งเตือนใหม่ */
  created: number;
  /** เดิมเตือนว่าเหลือน้อย แต่ตอนนี้หมดแล้ว → เตือนใหม่ */
  escalated: number;
  /** ของกลับมาปกติ → ปิดรายการเดิมให้เอง */
  resolved: number;
  alerts: number;
  scannedAt: string;
}

/**
 * ตรวจและแจ้งเตือน
 *
 * `variantIds` = ตรวจเฉพาะตัวเลือกที่เพิ่งเปลี่ยน (ใช้ตอนสต็อกขยับ)
 * ไม่ส่ง = ตรวจทั้งร้าน (ใช้ตอนแอดมินกดตรวจ และงานตามกำหนดเวลาใน STEP 52)
 *
 * ⚠️ ปิดรายการเดิมเมื่อของกลับมาปกติได้เฉพาะตอนตรวจทั้งร้าน หรือเมื่อตัวเลือกนั้น
 *    อยู่ใน `variantIds` — จะได้ไม่ไปปิดรายการของตัวเลือกอื่นที่ไม่ได้ตรวจ
 */
export async function runStockAlertScan(
  options: { variantIds?: string[] } = {},
): Promise<ScanResult> {
  const { variantIds } = options;

  const [rows, openNotifications] = await Promise.all([
    findAlertRows(variantIds),
    findOpenNotifications(),
  ]);

  const alerting = new Map(rows.map((row) => [row.variantId, row]));
  const openByVariant = new Map<string, { id: string; payload: AlertPayload }>();

  for (const notification of openNotifications) {
    const payload = readPayload(notification.data);
    if (payload === null) continue;
    // เก็บรายการล่าสุดของแต่ละตัวเลือกไว้ (เรียง desc มาแล้ว)
    if (!openByVariant.has(payload.variantId)) {
      openByVariant.set(payload.variantId, { id: notification.id, payload });
    }
  }

  const inScope = (variantId: string): boolean =>
    variantIds === undefined || variantIds.includes(variantId);

  let created = 0;
  let escalated = 0;
  let resolved = 0;

  for (const row of rows) {
    const severity = severityOf(row);
    const open = openByVariant.get(row.variantId);

    if (open !== undefined) {
      const known = SEVERITY_RANK[open.payload.severity] ?? 0;

      // เตือนไปแล้วในระดับเท่ากันหรือแย่กว่า → ไม่ต้องบอกซ้ำ
      if (known >= SEVERITY_RANK[severity]) continue;

      // แย่ลงกว่าที่เคยบอก → ปิดรายการเดิมแล้วแจ้งใหม่
      await closeNotification(
        open.id,
        open.payload,
        'system',
        'ถูกแทนด้วยการแจ้งเตือนระดับที่รุนแรงกว่า',
      );
      escalated += 1;
    }

    await createAlertNotification(row, severity);
    if (open === undefined) created += 1;
  }

  // ของที่เคยเตือนไว้แต่ตอนนี้กลับมาปกติ (หรือเลิกขายแล้ว) → ปิดให้เอง
  for (const [variantId, open] of openByVariant) {
    if (alerting.has(variantId) || !inScope(variantId)) continue;

    await closeNotification(open.id, open.payload, 'system', 'สต็อกกลับมาอยู่เหนือจุดเตือนแล้ว');
    resolved += 1;
  }

  const result: ScanResult = {
    created,
    escalated,
    resolved,
    alerts: rows.length,
    scannedAt: new Date().toISOString(),
  };

  if (created + escalated + resolved > 0) {
    logger.info(result, 'stock alert scan');
  }

  return result;
}

async function createAlertNotification(row: AlertRow, severity: AlertSeverity): Promise<void> {
  const label = variantLabel(row);

  const title =
    severity === 'OUT_OF_STOCK'
      ? `สินค้าหมด: ${row.productName} (${label})`
      : `สต็อกเหลือน้อย: ${row.productName} (${label})`;

  const body =
    severity === 'OUT_OF_STOCK'
      ? `ขายต่อไม่ได้แล้ว — ในคลัง ${row.quantity} ชิ้น ถูกจองไว้ ${row.reserved} ชิ้น เหลือขายได้ 0 ชิ้น`
      : `เหลือขายได้ ${row.available} ชิ้น (จุดเตือน ${row.minimumStock} ชิ้น) — ในคลัง ${row.quantity} ชิ้น ถูกจองไว้ ${row.reserved} ชิ้น`;

  const payload: AlertPayload = {
    variantId: row.variantId,
    productId: row.productId,
    productSlug: row.productSlug,
    sku: row.sku,
    severity,
    available: row.available,
    minimumStock: row.minimumStock,
  };

  await getPrisma().notification.create({
    data: {
      // null = ประกาศถึงพนักงานทุกคน (การแจ้งเตือนรายบุคคลเป็นงานของ STEP 24)
      userId: null,
      type: 'LOW_STOCK',
      channel: 'IN_APP',
      // แจ้งเตือนในระบบถือว่าส่งถึงทันทีที่บันทึก — ต่างจากอีเมลที่ต้องรอตัวส่งจริง
      status: 'SENT',
      sentAt: new Date(),
      title,
      body,
      data: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

async function closeNotification(
  id: string,
  payload: AlertPayload,
  closedBy: 'system' | 'staff',
  closedReason: string,
): Promise<void> {
  /**
   * `readAt` คือสิ่งที่บอกว่ารายการนี้ "จบแล้ว" (ใช้เป็นกุญแจกันแจ้งซ้ำ)
   * แต่จบได้ 2 ทาง — คนกดรับทราบ หรือระบบปิดเพราะเงื่อนไขหมดไป
   * จึงบันทึกไว้ใน `data` ว่าใครปิดและเพราะอะไร ไม่ให้ประวัติกำกวม
   */
  await getPrisma().notification.update({
    where: { id },
    data: {
      readAt: new Date(),
      data: { ...payload, closedBy, closedReason } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * ตรวจเตือนหลังสต็อกเปลี่ยน — **ต้องเรียกหลังทรานแซกชัน commit แล้วเท่านั้น**
 *
 * ห้ามให้ความล้มเหลวของการแจ้งเตือนทำให้งานหลัก (ปรับสต็อก/สั่งซื้อ/ชำระเงิน) พัง
 * จึงกลืน error ไว้แล้ว log ทิ้ง — การแจ้งเตือนเป็นงานรอง ไม่ใช่เงื่อนไขของการขาย
 */
export async function scanAlertsAfterStockChange(variantIds: string[]): Promise<void> {
  const unique = [...new Set(variantIds.filter((id) => id !== ''))];

  if (unique.length === 0) return;

  try {
    await runStockAlertScan({ variantIds: unique });
  } catch (error) {
    logger.error({ err: error, variantIds: unique }, 'stock alert scan failed after stock change');
  }
}

/* ─────────────────────────── อ่านรายการเตือน ─────────────────────────── */

export interface StockAlertListResult {
  items: StockAlertDto[];
  summary: {
    outOfStock: number;
    lowStock: number;
    /** จำนวนที่ยังไม่มีใครรับทราบ — ใช้เป็นตัวเลขบนป้ายแจ้งเตือน */
    unacknowledged: number;
  };
  channels: ReturnType<typeof notificationChannels>;
  /** ช่องทางอีเมลพร้อมใช้ไหม — UI ต้องบอกความจริงข้อนี้ */
  emailConfigured: boolean;
  generatedAt: string;
}

export async function listStockAlerts(
  query: { severity?: AlertSeverity } = {},
): Promise<StockAlertListResult> {
  const [rows, openNotifications] = await Promise.all([findAlertRows(), findOpenNotifications()]);

  const openByVariant = new Map<string, { id: string; createdAt: Date }>();
  for (const notification of openNotifications) {
    const payload = readPayload(notification.data);
    if (payload === null) continue;
    if (!openByVariant.has(payload.variantId)) {
      openByVariant.set(payload.variantId, {
        id: notification.id,
        createdAt: notification.createdAt,
      });
    }
  }

  const all: StockAlertDto[] = rows.map((row) => {
    const open = openByVariant.get(row.variantId);

    return {
      variantId: row.variantId,
      sku: row.sku,
      severity: severityOf(row),
      quantity: row.quantity,
      reserved: row.reserved,
      available: row.available,
      minimumStock: row.minimumStock,
      color: row.colorName,
      size: row.sizeName,
      product: { id: row.productId, name: row.productName, slug: row.productSlug },
      notification:
        open === undefined ? null : { id: open.id, createdAt: open.createdAt.toISOString() },
    };
  });

  const items =
    query.severity === undefined ? all : all.filter((item) => item.severity === query.severity);

  return {
    items,
    summary: {
      outOfStock: all.filter((item) => item.severity === 'OUT_OF_STOCK').length,
      lowStock: all.filter((item) => item.severity === 'LOW_STOCK').length,
      unacknowledged: all.filter((item) => item.notification !== null).length,
    },
    channels: notificationChannels(),
    emailConfigured: isEmailConfigured,
    generatedAt: new Date().toISOString(),
  };
}

/** จำนวนการเตือนที่ยังไม่มีใครรับทราบ — ใช้กับป้ายบนแถบหลังบ้าน (คิวรีเดียว เบา) */
export async function countUnacknowledgedAlerts(): Promise<number> {
  return getPrisma().notification.count({
    where: { type: 'LOW_STOCK', channel: 'IN_APP', readAt: null },
  });
}

/**
 * รับทราบการแจ้งเตือน — ปิดรายการเพื่อไม่ให้ค้างบนป้าย
 *
 * ⚠️ **การรับทราบไม่ได้แก้ปัญหาสต็อก** ของก็ยังเหลือน้อยอยู่ จึงยังอยู่ในรายการเตือนสด
 *    (และถ้าของแย่ลงกว่าเดิม ระบบจะเตือนใหม่)
 */
export async function acknowledgeStockAlert(
  notificationId: string,
  actorUserId: string,
): Promise<void> {
  const notification = await getPrisma().notification.findFirst({
    where: { id: notificationId, type: 'LOW_STOCK' },
    select: { id: true, data: true, readAt: true },
  });

  if (!notification) {
    throw ApiError.notFound('ไม่พบการแจ้งเตือนนี้');
  }

  if (notification.readAt !== null) {
    throw ApiError.conflict('การแจ้งเตือนนี้ถูกปิดไปแล้ว');
  }

  const payload = readPayload(notification.data);

  if (payload === null) {
    throw ApiError.conflict('ข้อมูลของการแจ้งเตือนนี้ไม่ครบ');
  }

  await closeNotification(notification.id, payload, 'staff', `รับทราบโดยผู้ใช้ ${actorUserId}`);
}
