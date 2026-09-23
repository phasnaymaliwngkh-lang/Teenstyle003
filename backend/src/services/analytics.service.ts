import { getPrisma, Prisma } from '@teenstyle/database';
import ExcelJS from 'exceljs';

import { STORE_TIME_ZONE } from '../config/store.ts';
import {
  bucketLabelSql,
  changeRatio,
  daysBetween,
  fillSeries,
  ORDER_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  previousRange,
  shareOf,
  SHIPPING_METHOD_LABEL,
  utcTs,
  zonedDayEnd,
  zonedDayStart,
  type AnalyticsRangeDto,
  type BreakdownRowDto,
  type CustomerRankingDto,
  type Granularity,
  type MetricDto,
  type ProductPerformanceDto,
  type SalesBreakdownDto,
  type SalesSummaryDto,
} from '../models/analytics.model.ts';
import { toNumber } from '../models/pricing.ts';
import {
  extensionFor,
  mimeTypeFor,
  styleWorksheet,
  workbookToBuffer,
  type ExportResult,
} from '../models/spreadsheet.ts';
import type {
  AnalyticsExportQuery,
  AnalyticsRangeQuery,
  CustomerRankingQuery,
  ProductPerformanceQuery,
} from '../validators/analytics.validator.ts';

/**
 * รายงานยอดขาย (STEP 26)
 *
 * กฎที่ห้ามละเมิด
 *
 *   1. **ทุกตัวเลขมาจากฐานข้อมูลจริง** ไม่มีข้อมูลก็คืน 0 หรือรายการว่าง
 *      **ห้ามใส่กราฟหรือยอดตัวอย่างให้หน้ารายงานดูสวย** (กฎ STEP 13 ข้อ 6)
 *
 *   2. **"ยอดขาย" = เงินที่ได้รับจริง** (`paymentStatus = PAID` และไม่ถูกยกเลิก/คืนเงิน)
 *      และ **ตัดรอบตาม `paidAt` ไม่ใช่ `createdAt`** เพราะรายงานนี้ตอบคำถามว่า
 *      "เดือนนี้ร้านได้เงินเท่าไร" ไม่ใช่ "เดือนนี้มีคนกดสั่งกี่ใบ"
 *      เรื่องนี้สำคัญมากกับ COD ซึ่งได้เงินตอนส่งถึง — บางใบสั่งเดือนหนึ่งแต่ได้เงินอีกเดือน
 *      (ส่วนรายงานที่นับ "ใบที่สร้าง" เช่น `ordersByStatus` ใช้ `createdAt` และบอกไว้ชัด)
 *
 *   3. **ตัดวันตามโซนเวลาของร้าน** ผ่าน `bucketLabelSql` / `zonedDayStart` เสมอ
 *      `date_trunc` เปล่า ๆ ตัดตาม UTC → ยอดช่วง 00:00–07:00 น. ตกไปอยู่เมื่อวานทุกวัน
 *
 *   4. **ช่วงที่ไม่มีคำสั่งซื้อต้องเป็นจุด 0 ในกราฟ ไม่ใช่หายไป** (`fillSeries`)
 *
 *   5. **การเรียงอันดับต้องเรียงก่อนแบ่งหน้า** จึงทำใน SQL ทั้งหมด
 *      เรียงเฉพาะแถวในหน้าปัจจุบันคืออันดับปลอม (บั๊กชนิดเดียวกับตัวกรอง "สต็อกต่ำ" STEP 14 ข้อ 7)
 *      — นี่คืองานที่ STEP 25 กันไว้ให้ STEP 26 ทำ
 *
 *   6. **ค่าที่ผู้ใช้ส่งมาเข้าเป็น parameter ของ `Prisma.sql` เสมอ** ส่วนที่ต่อเป็นสตริง
 *      (`ORDER BY`, หน่วยของ `date_trunc`) มาจาก Zod enum ที่เป็น whitelist เท่านั้น
 */

/* ────────────────────────── เงื่อนไขกลาง ────────────────────────── */

/**
 * ออเดอร์ที่นับเป็นรายได้ — เกณฑ์เดียวกับ dashboard (STEP 13) และหน้าลูกค้า (STEP 25)
 * `paidAt IS NOT NULL` เป็นการกันเชิงป้องกัน: ทุกเส้นทางที่ตั้ง PAID ตั้ง `paidAt` พร้อมกันอยู่แล้ว
 * แต่ถ้าวันหนึ่งมีเส้นทางใหม่ที่ลืม แถวนั้นต้องตกจากกราฟ ไม่ใช่ไปโผล่ที่ช่วงเวลามั่ว ๆ
 */
function paidOrdersSql(start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    o."deletedAt" IS NULL
    AND o."paymentStatus" = 'PAID'
    AND o."status" NOT IN ('CANCELLED', 'REFUNDED')
    AND o."paidAt" IS NOT NULL
    AND o."paidAt" >= ${utcTs(start)} AND o."paidAt" <= ${utcTs(end)}
  `;
}

const PAID_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  paymentStatus: 'PAID',
  status: { notIn: ['CANCELLED', 'REFUNDED'] },
  paidAt: { not: null },
};

function paidWhereIn(start: Date, end: Date): Prisma.OrderWhereInput {
  return { ...PAID_WHERE, paidAt: { gte: start, lte: end } };
}

function rangeDto(from: string, to: string, granularity: Granularity): AnalyticsRangeDto {
  return {
    from,
    to,
    granularity,
    timeZone: STORE_TIME_ZONE,
    days: daysBetween(from, to),
    comparedTo: previousRange(from, to),
  };
}

function metric(value: number, previous: number): MetricDto {
  return { value, previous, changePercent: changeRatio(value, previous) };
}

/* ────────────────────────── สรุปยอดขาย ────────────────────────── */

interface SeriesRow {
  bucket: string;
  revenue: string;
  orders: number;
}

export async function getSalesSummary(query: AnalyticsRangeQuery): Promise<SalesSummaryDto> {
  const prisma = getPrisma();

  const start = zonedDayStart(query.from);
  const end = zonedDayEnd(query.to);
  const before = previousRange(query.from, query.to);
  const prevStart = zonedDayStart(before.from);
  const prevEnd = zonedDayEnd(before.to);

  const [current, previous, currentCustomers, previousCustomers, pendingCod, series] =
    await Promise.all([
      prisma.order.aggregate({
        where: paidWhereIn(start, end),
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: paidWhereIn(prevStart, prevEnd),
        _sum: { total: true },
        _count: { _all: true },
      }),
      countPayingCustomers(start, end),
      countPayingCustomers(prevStart, prevEnd),
      /**
       * COD ที่ยืนยันแล้วแต่ยังไม่ได้เก็บเงิน — เป็น **ยอดคงค้าง ณ ตอนนี้** ไม่ใช่ยอดของช่วงที่เลือก
       * (ยังไม่มี `paidAt` จึงไม่มีวันให้ตัดรอบ) หน้าเว็บต้องบอกให้ชัดว่านี่ยังไม่ใช่รายได้
       */
      prisma.order.aggregate({
        where: {
          deletedAt: null,
          paymentStatus: 'PENDING',
          status: { in: ['PROCESSING', 'PACKING', 'SHIPPING'] },
        },
        _sum: { total: true },
      }),
      prisma.$queryRaw<SeriesRow[]>`
        SELECT ${bucketLabelSql(Prisma.sql`o."paidAt"`, query.granularity)} AS bucket,
               COALESCE(sum(o."total"), 0)::text AS revenue,
               count(*)::int AS orders
        FROM "Order" o
        WHERE ${paidOrdersSql(start, end)}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

  const revenue = toNumber(current._sum.total);
  const prevRevenue = toNumber(previous._sum.total);
  const orders = current._count._all;
  const prevOrders = previous._count._all;

  const aov = orders > 0 ? Math.round(revenue / orders) : 0;
  const prevAov = prevOrders > 0 ? Math.round(prevRevenue / prevOrders) : 0;

  return {
    range: rangeDto(query.from, query.to, query.granularity),
    revenue: metric(revenue, prevRevenue),
    paidOrders: metric(orders, prevOrders),
    averageOrderValue: metric(aov, prevAov),
    payingCustomers: metric(currentCustomers, previousCustomers),
    pendingCodAmount: toNumber(pendingCod._sum.total),
    series: fillSeries(query.from, query.to, query.granularity, series, (bucket, row) => ({
      bucket,
      revenue: row ? toNumber(row.revenue) : 0,
      orders: row?.orders ?? 0,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** จำนวน "หัว" ของลูกค้าที่จ่ายเงินในช่วงนี้ — ไม่ใช่จำนวนใบ */
async function countPayingCustomers(start: Date, end: Date): Promise<number> {
  const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
    SELECT count(DISTINCT o."userId")::int AS count
    FROM "Order" o
    WHERE ${paidOrdersSql(start, end)}
  `;

  return rows[0]?.count ?? 0;
}

/* ────────────────────────── อันดับสินค้า ────────────────────────── */

interface ProductRow {
  productId: string | null;
  currentName: string | null;
  snapshotName: string;
  slug: string | null;
  quantity: number;
  revenue: string;
  orders: number;
  totalRows: number;
}

function productOrderBy(sort: ProductPerformanceQuery['sort']): Prisma.Sql {
  switch (sort) {
    case 'quantity':
      return Prisma.sql`sum(oi."quantity") DESC, sum(oi."lineTotal") DESC`;
    case 'orders':
      return Prisma.sql`count(DISTINCT oi."orderId") DESC, sum(oi."lineTotal") DESC`;
    case 'revenue':
    default:
      return Prisma.sql`sum(oi."lineTotal") DESC, sum(oi."quantity") DESC`;
  }
}

export async function getProductPerformance(
  query: ProductPerformanceQuery,
): Promise<ProductPerformanceDto> {
  const prisma = getPrisma();

  const start = zonedDayStart(query.from);
  const end = zonedDayEnd(query.to);
  const offset = (query.page - 1) * query.limit;

  /**
   * จัดกลุ่มด้วย `oi."productId"` อย่างเดียว — **ห้ามใส่ `productName` ลงใน GROUP BY**
   * เพราะ `productName` เป็น snapshot ตอนสั่ง สินค้าที่ถูกเปลี่ยนชื่อกลางช่วง
   * จะแตกเป็นสองแถวแล้วอันดับเพี้ยนทันที
   *
   * ชื่อที่แสดงใช้ชื่อปัจจุบันจากตาราง `Product` (คนดูรายงานกำลังมองแคตตาล็อกวันนี้)
   * และถอยไปใช้ snapshot เมื่อสินค้าไม่มีในระบบแล้ว
   */
  const rows = await prisma.$queryRaw<ProductRow[]>`
    SELECT oi."productId" AS "productId",
           max(p."name") AS "currentName",
           max(oi."productName") AS "snapshotName",
           max(p."slug") AS slug,
           sum(oi."quantity")::int AS quantity,
           sum(oi."lineTotal")::text AS revenue,
           count(DISTINCT oi."orderId")::int AS orders,
           (count(*) OVER ())::int AS "totalRows"
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    LEFT JOIN "Product" p ON p."id" = oi."productId"
    WHERE ${paidOrdersSql(start, end)}
    GROUP BY oi."productId"
    ORDER BY ${productOrderBy(query.sort)}
    LIMIT ${query.limit} OFFSET ${offset}
  `;

  const totals = await prisma.$queryRaw<Array<{ quantity: number; revenue: string }>>`
    SELECT COALESCE(sum(oi."quantity"), 0)::int AS quantity,
           COALESCE(sum(oi."lineTotal"), 0)::text AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE ${paidOrdersSql(start, end)}
  `;

  const total = rows[0]?.totalRows ?? 0;

  return {
    range: rangeDto(query.from, query.to, query.granularity),
    items: rows.map((row) => ({
      productId: row.productId,
      /**
       * สินค้าที่ไม่มี `productId` แล้วคือแถวที่ถูกลบออกจากระบบจริง ๆ (ไม่ใช่ soft delete)
       * ทุกรายการแบบนั้นถูกยุบเป็นกลุ่มเดียว จึงต้องบอกตรง ๆ ว่าเป็นยอดรวม
       * **ห้ามหยิบชื่อใดชื่อหนึ่งในกลุ่มมาแสดงเป็นชื่อของทั้งกลุ่ม**
       */
      productName:
        row.productId === null
          ? 'สินค้าที่ถูกลบออกจากระบบ (รวมทุกรายการ)'
          : (row.currentName ?? row.snapshotName),
      slug: row.slug,
      quantity: row.quantity,
      revenue: toNumber(row.revenue),
      orders: row.orders,
    })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
    totals: {
      quantity: totals[0]?.quantity ?? 0,
      revenue: toNumber(totals[0]?.revenue ?? 0),
    },
  };
}

/* ────────────────────────── อันดับลูกค้า ────────────────────────── */

interface CustomerRow {
  userId: string;
  orders: number;
  revenue: string;
  firstOrderAt: Date;
  lastOrderAt: Date;
  totalRows: number;
}

function customerOrderBy(sort: CustomerRankingQuery['sort']): Prisma.Sql {
  return sort === 'orders'
    ? Prisma.sql`count(*) DESC, sum(o."total") DESC`
    : Prisma.sql`sum(o."total") DESC, count(*) DESC`;
}

/**
 * อันดับลูกค้าตามยอดซื้อ — **หนี้ที่ STEP 25 กันไว้ให้ทำที่นี่**
 *
 * ⚠️ เรียงและนับทั้งหมดใน SQL **ก่อน** `LIMIT/OFFSET`
 *    ถ้าดึงลูกค้ามาหนึ่งหน้าแล้วค่อยเรียงใน TypeScript จะได้ "อันดับของ 20 คนที่หยิบมาได้"
 *    ซึ่งไม่ใช่อันดับจริง และผิดแบบที่ผู้ใช้จับไม่ได้
 */
export async function getCustomerRanking(query: CustomerRankingQuery): Promise<CustomerRankingDto> {
  const prisma = getPrisma();

  const start = zonedDayStart(query.from);
  const end = zonedDayEnd(query.to);
  const offset = (query.page - 1) * query.limit;

  const [rows, repeat] = await Promise.all([
    prisma.$queryRaw<CustomerRow[]>`
      SELECT o."userId" AS "userId",
             count(*)::int AS orders,
             sum(o."total")::text AS revenue,
             min(o."paidAt") AS "firstOrderAt",
             max(o."paidAt") AS "lastOrderAt",
             (count(*) OVER ())::int AS "totalRows"
      FROM "Order" o
      WHERE ${paidOrdersSql(start, end)}
      GROUP BY o."userId"
      ORDER BY ${customerOrderBy(query.sort)}
      LIMIT ${query.limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM (
        SELECT o."userId"
        FROM "Order" o
        WHERE ${paidOrdersSql(start, end)}
        GROUP BY o."userId"
        HAVING count(*) > 1
      ) AS repeat_buyers
    `,
  ]);

  const users =
    rows.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: rows.map((row) => row.userId) } },
          select: { id: true, name: true, email: true },
        })
      : [];

  const userById = new Map(users.map((user) => [user.id, user]));
  const total = rows[0]?.totalRows ?? 0;

  return {
    range: rangeDto(query.from, query.to, query.granularity),
    items: rows.map((row) => {
      const revenue = toNumber(row.revenue);
      const user = userById.get(row.userId);

      return {
        userId: row.userId,
        name: user?.name ?? null,
        // บัญชีถูกลบไปแล้วแต่ออเดอร์ยังอยู่ — บอกตรง ๆ ไม่เดาอีเมลให้
        email: user?.email ?? '(บัญชีถูกลบแล้ว)',
        orders: row.orders,
        revenue,
        averageOrderValue: row.orders > 0 ? Math.round(revenue / row.orders) : 0,
        firstOrderAt: row.firstOrderAt.toISOString(),
        lastOrderAt: row.lastOrderAt.toISOString(),
      };
    }),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
    repeatCustomers: repeat[0]?.count ?? 0,
  };
}

/* ────────────────────────── แยกตามมิติต่าง ๆ ────────────────────────── */

interface BreakdownRow {
  key: string | null;
  orders: number;
  revenue: string;
}

function toBreakdown(
  rows: BreakdownRow[],
  labels: Readonly<Record<string, string>>,
  fallbackKey: string,
  fallbackLabel: string,
): BreakdownRowDto[] {
  const total = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);

  return rows.map((row) => {
    const revenue = toNumber(row.revenue);
    const key = row.key ?? fallbackKey;

    return {
      key,
      // ค่าที่ยังไม่มีชื่อไทย แสดงรหัสเดิม — ดีกว่าเดาชื่อให้แล้วผิด
      label: row.key === null ? fallbackLabel : (labels[row.key] ?? row.key),
      orders: row.orders,
      revenue,
      share: shareOf(revenue, total),
    };
  });
}

export async function getSalesBreakdown(query: AnalyticsRangeQuery): Promise<SalesBreakdownDto> {
  const prisma = getPrisma();

  const start = zonedDayStart(query.from);
  const end = zonedDayEnd(query.to);

  const [byCategory, byProvider, byShipping, byStatus, reconciliation] = await Promise.all([
    /**
     * ยอดตามหมวดหมู่คิดจาก `OrderItem.lineTotal` (ยอดสินค้า)
     * **ไม่ใช่ `Order.total`** เพราะหนึ่งใบมีได้หลายหมวด ค่าจัดส่งจึงหารลงหมวดไม่ได้
     */
    prisma.$queryRaw<BreakdownRow[]>`
      SELECT c."name" AS key,
             count(DISTINCT oi."orderId")::int AS orders,
             COALESCE(sum(oi."lineTotal"), 0)::text AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      LEFT JOIN "Product" p ON p."id" = oi."productId"
      LEFT JOIN "Category" c ON c."id" = p."categoryId"
      WHERE ${paidOrdersSql(start, end)}
      GROUP BY c."name"
      ORDER BY 3 DESC
    `,
    /**
     * ช่องทางชำระเงินอ่านจากตาราง `Payment` ที่ `status = PAID`
     * (ใบที่ลองจ่ายแล้วไม่ผ่านมีแถว FAILED อยู่ด้วย จึงต้องกรอง ไม่งั้นนับซ้ำ)
     */
    prisma.$queryRaw<BreakdownRow[]>`
      SELECT pay."provider"::text AS key,
             count(DISTINCT pay."orderId")::int AS orders,
             COALESCE(sum(pay."amount"), 0)::text AS revenue
      FROM "Payment" pay
      JOIN "Order" o ON o."id" = pay."orderId"
      WHERE pay."status" = 'PAID' AND ${paidOrdersSql(start, end)}
      GROUP BY pay."provider"
      ORDER BY 3 DESC
    `,
    prisma.$queryRaw<BreakdownRow[]>`
      SELECT o."shippingMethod"::text AS key,
             count(*)::int AS orders,
             COALESCE(sum(o."total"), 0)::text AS revenue
      FROM "Order" o
      WHERE ${paidOrdersSql(start, end)}
      GROUP BY o."shippingMethod"
      ORDER BY 3 DESC
    `,
    /**
     * ⚠️ ตารางนี้นับ **ใบที่ถูกสร้างในช่วงนี้** (`createdAt`) ไม่ใช่ใบที่ได้เงินในช่วงนี้
     *    เพราะจุดประสงค์คือดูว่าออเดอร์ที่เข้ามาไปจบที่สถานะไหนบ้าง (รวมที่ยกเลิก)
     *    หน้าเว็บต้องเขียนกำกับให้ชัด ไม่งั้นคนอ่านจะเอาไปบวกกับยอดขายด้านบน
     */
    prisma.$queryRaw<BreakdownRow[]>`
      SELECT o."status"::text AS key,
             count(*)::int AS orders,
             COALESCE(sum(o."total"), 0)::text AS revenue
      FROM "Order" o
      WHERE o."deletedAt" IS NULL
        AND o."createdAt" >= ${utcTs(start)} AND o."createdAt" <= ${utcTs(end)}
      GROUP BY o."status"
      ORDER BY 2 DESC
    `,
    /**
     * ⚠️ `Order.total` = ยอดสินค้า − ส่วนลด + ค่าจัดส่ง
     *    จึง **ไม่มีทางเท่ากับผลรวม `OrderItem.lineTotal`** และนั่นถูกต้องแล้ว
     *    ส่งทั้งสี่ค่าไปให้หน้าเว็บอธิบายผู้ใช้ ไม่ใช่ตัวเลขที่ต้องไล่ "แก้ให้ตรงกัน"
     */
    prisma.$queryRaw<
      Array<{
        orderRevenue: string;
        shippingFees: string;
        discounts: string;
        productRevenue: string;
      }>
    >`
      SELECT COALESCE(sum(o."total"), 0)::text AS "orderRevenue",
             COALESCE(sum(o."shippingFee"), 0)::text AS "shippingFees",
             COALESCE(sum(o."discountTotal"), 0)::text AS "discounts",
             COALESCE((
               SELECT sum(oi."lineTotal")
               FROM "OrderItem" oi
               JOIN "Order" o2 ON o2."id" = oi."orderId"
               WHERE o2."deletedAt" IS NULL
                 AND o2."paymentStatus" = 'PAID'
                 AND o2."status" NOT IN ('CANCELLED', 'REFUNDED')
                 AND o2."paidAt" IS NOT NULL
                 AND o2."paidAt" >= ${utcTs(start)} AND o2."paidAt" <= ${utcTs(end)}
             ), 0)::text AS "productRevenue"
      FROM "Order" o
      WHERE ${paidOrdersSql(start, end)}
    `,
  ]);

  return {
    range: rangeDto(query.from, query.to, query.granularity),
    byCategory: toBreakdown(byCategory, {}, 'UNKNOWN', 'ไม่ทราบหมวดหมู่ (สินค้าถูกลบแล้ว)'),
    byPaymentProvider: toBreakdown(byProvider, PAYMENT_PROVIDER_LABEL, 'UNKNOWN', 'ไม่ระบุช่องทาง'),
    byShippingMethod: toBreakdown(
      byShipping,
      SHIPPING_METHOD_LABEL,
      'UNKNOWN',
      'ไม่ระบุวิธีจัดส่ง',
    ),
    ordersByStatus: toBreakdown(byStatus, ORDER_STATUS_LABEL, 'UNKNOWN', 'ไม่ระบุสถานะ'),
    reconciliation: {
      orderRevenue: toNumber(reconciliation[0]?.orderRevenue ?? 0),
      productRevenue: toNumber(reconciliation[0]?.productRevenue ?? 0),
      shippingFees: toNumber(reconciliation[0]?.shippingFees ?? 0),
      discounts: toNumber(reconciliation[0]?.discounts ?? 0),
    },
  };
}

/* ────────────────────────── ส่งออกรายงานเป็นไฟล์ ────────────────────────── */

/**
 * ส่งออกรายงานของช่วงที่เลือกเป็น CSV / Excel (STEP 26)
 *
 * ⚠️ **ตัวเลขในไฟล์ต้องมาจากฟังก์ชันเดียวกับที่หน้าเว็บใช้** (`getSalesSummary` ฯลฯ)
 *    ถ้าเขียนคิวรีชุดใหม่สำหรับไฟล์ วันหนึ่งไฟล์กับหน้าจอจะไม่ตรงกัน
 *    แล้วไม่มีใครรู้ว่าอันไหนถูก (ปัญหาเดียวกับที่เจอตอน STEP 21 เรื่องนโยบายสองชุด)
 *
 * ⚠️ CSV เก็บได้ชีตเดียว — ไฟล์ CSV จึงได้เฉพาะตารางรายวัน ส่วน Excel ได้ครบทุกชีต
 *    บอกผู้ใช้ไว้ที่หน้าเว็บ ไม่ใช่ปล่อยให้ดาวน์โหลดแล้วสงสัยว่าข้อมูลหายไปไหน
 */
export async function exportAnalyticsReport(query: AnalyticsExportQuery): Promise<ExportResult> {
  const range = { from: query.from, to: query.to, granularity: query.granularity };

  const [summary, products, customers, breakdown] = await Promise.all([
    getSalesSummary(range),
    getProductPerformance({ ...range, sort: 'revenue', page: 1, limit: 50 }),
    getCustomerRanking({ ...range, sort: 'revenue', page: 1, limit: 50 }),
    getSalesBreakdown(range),
  ]);

  const workbook = new ExcelJS.Workbook();

  // ⚠️ ชื่อชีตของ Excel ยาวได้ไม่เกิน 31 ตัวอักษร — ยาวกว่านั้นถูกตัดท้ายทิ้งเงียบ ๆ
  //    (เจอจริงตอนตรวจ STEP 26: ชื่อเดิมโดนตัดจนคำสุดท้ายขาดหาย)
  // ชีตแรกต้องเป็นตารางรายวัน เพราะ CSV เก็บได้แค่ชีตแรก
  const sales = workbook.addWorksheet('ยอดขายรายช่วง');
  sales.columns = [
    { header: 'ช่วงเวลา', key: 'bucket' },
    { header: 'ยอดขาย (บาท)', key: 'revenue' },
    { header: 'จำนวนคำสั่งซื้อ', key: 'orders' },
  ];
  for (const point of summary.series) {
    sales.addRow({ bucket: point.bucket, revenue: point.revenue, orders: point.orders });
  }
  styleWorksheet(sales);

  if (query.format !== 'csv') {
    const overview = workbook.addWorksheet('สรุป');
    overview.columns = [
      { header: 'รายการ', key: 'label' },
      { header: 'ช่วงที่เลือก', key: 'value' },
      { header: 'ช่วงก่อนหน้า', key: 'previous' },
      { header: 'เปลี่ยนแปลง (%)', key: 'change' },
    ];
    const metrics: Array<[string, MetricDto]> = [
      ['ยอดขาย (บาท)', summary.revenue],
      ['คำสั่งซื้อที่ได้รับเงิน', summary.paidOrders],
      ['ยอดเฉลี่ยต่อใบ (บาท)', summary.averageOrderValue],
      ['ลูกค้าที่ซื้อ (คน)', summary.payingCustomers],
    ];
    for (const [label, value] of metrics) {
      overview.addRow({
        label,
        value: value.value,
        previous: value.previous,
        // ไม่มีฐานให้เทียบ → เขียนว่าเทียบไม่ได้ ห้ามใส่ 0 หรือ 100%
        change: value.changePercent ?? 'เทียบไม่ได้ (ช่วงก่อนหน้าเป็น 0)',
      });
    }
    overview.addRow({});
    overview.addRow({ label: 'ช่วงที่เลือก', value: `${query.from} ถึง ${query.to}` });
    overview.addRow({
      label: 'ช่วงที่ใช้เทียบ',
      value: `${summary.range.comparedTo.from} ถึง ${summary.range.comparedTo.to}`,
    });
    overview.addRow({ label: 'โซนเวลาที่ใช้ตัดวัน', value: summary.range.timeZone });
    overview.addRow({
      label: 'COD ที่ยังไม่ได้เก็บเงิน (ยอดคงค้างวันนี้ ไม่ใช่รายได้)',
      value: summary.pendingCodAmount,
    });
    overview.addRow({
      label: 'ยอดรวมตามบิล (Order.total)',
      value: breakdown.reconciliation.orderRevenue,
    });
    overview.addRow({
      label: 'ยอดเฉพาะสินค้า (OrderItem)',
      value: breakdown.reconciliation.productRevenue,
    });
    overview.addRow({ label: 'ค่าจัดส่งที่เก็บได้', value: breakdown.reconciliation.shippingFees });
    overview.addRow({ label: 'ส่วนลดท้ายบิล', value: breakdown.reconciliation.discounts });
    styleWorksheet(overview);

    const productSheet = workbook.addWorksheet('สินค้าขายดี 50 อันดับ');
    productSheet.columns = [
      { header: 'อันดับ', key: 'rank' },
      { header: 'สินค้า', key: 'name' },
      { header: 'จำนวนที่ขายได้', key: 'quantity' },
      { header: 'ยอดขาย (บาท)', key: 'revenue' },
      { header: 'จำนวนใบที่มีสินค้านี้', key: 'orders' },
    ];
    products.items.forEach((item, index) => {
      productSheet.addRow({
        rank: index + 1,
        name: item.productName,
        quantity: item.quantity,
        revenue: item.revenue,
        orders: item.orders,
      });
    });
    styleWorksheet(productSheet);

    const customerSheet = workbook.addWorksheet('ลูกค้าที่ซื้อมากสุด 50 ราย');
    customerSheet.columns = [
      { header: 'อันดับ', key: 'rank' },
      { header: 'ชื่อ', key: 'name' },
      { header: 'อีเมล', key: 'email' },
      { header: 'จำนวนใบ', key: 'orders' },
      { header: 'ยอดซื้อ (บาท)', key: 'revenue' },
      { header: 'เฉลี่ยต่อใบ (บาท)', key: 'aov' },
    ];
    customers.items.forEach((item, index) => {
      customerSheet.addRow({
        rank: index + 1,
        name: item.name ?? '(ยังไม่ตั้งชื่อ)',
        email: item.email,
        orders: item.orders,
        revenue: item.revenue,
        aov: item.averageOrderValue,
      });
    });
    styleWorksheet(customerSheet);

    const breakdownSheet = workbook.addWorksheet('แยกตามมิติ');
    breakdownSheet.columns = [
      { header: 'มิติ', key: 'dimension' },
      { header: 'รายการ', key: 'label' },
      { header: 'จำนวนใบ', key: 'orders' },
      { header: 'ยอด (บาท)', key: 'revenue' },
      { header: 'สัดส่วน (%)', key: 'share' },
    ];
    const dimensions: Array<[string, BreakdownRowDto[]]> = [
      ['หมวดหมู่สินค้า', breakdown.byCategory],
      ['ช่องทางชำระเงิน', breakdown.byPaymentProvider],
      ['วิธีจัดส่ง', breakdown.byShippingMethod],
      ['สถานะของใบที่สร้างในช่วงนี้', breakdown.ordersByStatus],
    ];
    for (const [dimension, rows] of dimensions) {
      for (const row of rows) {
        breakdownSheet.addRow({
          dimension,
          label: row.label,
          orders: row.orders,
          revenue: row.revenue,
          share: row.share,
        });
      }
    }
    styleWorksheet(breakdownSheet);
  }

  const filename = `analytics_${query.from}_to_${query.to}.${extensionFor(query.format)}`;

  return {
    buffer: await workbookToBuffer(workbook, query.format),
    filename,
    mimeType: mimeTypeFor(query.format),
  };
}
