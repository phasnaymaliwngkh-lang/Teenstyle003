import { getPrisma, Prisma } from '@teenstyle/database';

import { AVAILABLE_STOCK_SQL } from '../models/availability.ts';
import { toNumber } from '../models/pricing.ts';

/**
 * ตัวเลขสรุปของหน้า Admin Dashboard (STEP 13)
 *
 * กฎที่ห้ามละเมิด
 *   1. **ทุกตัวเลขนับจากฐานข้อมูลจริง** — ถ้ายังไม่มีข้อมูลให้คืน 0 หรือรายการว่าง
 *      **ห้ามใส่ข้อมูลตัวอย่าง/กราฟปลอมให้หน้า dashboard ดูสวย**
 *   2. **"ยอดขาย" นับเฉพาะเงินที่ได้รับจริง** (`paymentStatus = PAID`)
 *      ออเดอร์ COD ที่ยังไม่เก็บเงินถูกแยกเป็น "รอเก็บเงินปลายทาง" ไม่รวมในยอดขาย
 *   3. ออเดอร์ที่ยกเลิก/คืนเงินไม่นับเป็นยอดขาย
 */

/** ช่วงเวลาที่ใช้สรุป (คิดจากเวลาที่ชำระเงินจริง) */
function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const PAID_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  paymentStatus: 'PAID',
  status: { notIn: ['CANCELLED', 'REFUNDED'] },
};

export interface AdminOverviewDto {
  revenue: {
    /** ยอดที่ได้รับเงินจริงแล้ว */
    total: number;
    last7Days: number;
    last30Days: number;
    paidOrders: number;
    /** ยอดของออเดอร์ COD ที่ยังไม่ได้เก็บเงิน (ยังไม่ใช่รายได้) */
    pendingCodAmount: number;
    averageOrderValue: number;
  };
  orders: {
    total: number;
    byStatus: { status: string; count: number }[];
    /** งานที่ต้องทำ */
    awaitingPayment: number;
    toProcess: number;
    toShip: number;
    last30Days: number;
  };
  products: { total: number; active: number; variants: number; outOfStock: number };
  inventory: { lowStock: number; totalUnits: number; reservedUnits: number };
  customers: { total: number; newLast30Days: number };
  /** สินค้าขายดี — นับจาก OrderItem ของออเดอร์ที่จ่ายเงินแล้วเท่านั้น (ว่างได้) */
  topProducts: {
    productId: string;
    name: string;
    slug: string;
    quantity: number;
    revenue: number;
  }[];
  generatedAt: string;
}

export async function getOverview(): Promise<AdminOverviewDto> {
  const prisma = getPrisma();

  const [
    revenueAll,
    revenue7,
    revenue30,
    codPending,
    ordersTotal,
    ordersByStatus,
    orders30,
    products,
    activeProducts,
    variants,
    outOfStock,
    lowStock,
    inventorySum,
    customers,
    newCustomers,
    topItems,
  ] = await Promise.all([
    prisma.order.aggregate({ where: PAID_WHERE, _sum: { total: true }, _count: { _all: true } }),
    prisma.order.aggregate({
      where: { ...PAID_WHERE, paidAt: { gte: since(7) } },
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: { ...PAID_WHERE, paidAt: { gte: since(30) } },
      _sum: { total: true },
    }),
    // COD ที่ยืนยันแล้วแต่ยังไม่ได้เงิน — แยกจากยอดขายเสมอ
    prisma.order.aggregate({
      where: {
        deletedAt: null,
        paymentStatus: 'PENDING',
        status: { in: ['PROCESSING', 'PACKING', 'SHIPPING'] },
      },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { deletedAt: null } }),
    prisma.order.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: since(30) } } }),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.productVariant.count({ where: { deletedAt: null } }),
    /**
     * "ของหมด" และ "สต็อกต่ำ" ต้องคิดจากจำนวนที่ **ขายได้จริง** (STEP 15)
     * ไม่ใช่ cache `totalStock` ที่ยังไม่หักของที่จองไว้ ไม่งั้นหน้า dashboard
     * จะบอกว่ามีของขายทั้งที่ของถูกจองไปหมดแล้ว
     */
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM "Product" p
      WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
        AND ${AVAILABLE_STOCK_SQL} = 0
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM "Product" p
      WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
        AND ${AVAILABLE_STOCK_SQL} <= p."minimumStock"
    `),
    prisma.inventory.aggregate({ _sum: { quantity: true, reservedQuantity: true } }),
    /**
     * "ลูกค้า" ต้องนับเฉพาะบทบาท CUSTOMER (แก้ตอน STEP 25)
     * เดิมนับผู้ใช้ทุกแถวจึงรวมบัญชีพนักงานและแอดมินเข้าไปด้วย → ตัวเลขบนหน้า dashboard
     * สูงกว่าจำนวนลูกค้าจริงตามจำนวนพนักงานที่มี (กฎ STEP 13 ข้อ 6: ตัวเลขต้องตรงกับความจริง)
     */
    prisma.user.count({ where: { deletedAt: null, role: { name: 'CUSTOMER' } } }),
    prisma.user.count({
      where: { deletedAt: null, role: { name: 'CUSTOMER' }, createdAt: { gte: since(30) } },
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null }, order: PAID_WHERE },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    }),
  ]);

  // เติมชื่อสินค้าให้อันดับขายดี (groupBy คืนแต่ id)
  const topProductIds = topItems
    .map((item) => item.productId)
    .filter((id): id is string => id !== null);

  const topProductRows =
    topProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: topProductIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];

  const nameById = new Map(topProductRows.map((row) => [row.id, row]));

  const paidCount = revenueAll._count._all;
  const revenueTotal = toNumber(revenueAll._sum.total);

  const statusCounts = ordersByStatus.map((row) => ({
    status: String(row.status),
    count: row._count._all,
  }));
  const countOf = (status: string): number =>
    statusCounts.find((row) => row.status === status)?.count ?? 0;

  return {
    revenue: {
      total: revenueTotal,
      last7Days: toNumber(revenue7._sum.total),
      last30Days: toNumber(revenue30._sum.total),
      paidOrders: paidCount,
      pendingCodAmount: toNumber(codPending._sum.total),
      averageOrderValue: paidCount > 0 ? Math.round(revenueTotal / paidCount) : 0,
    },
    orders: {
      total: ordersTotal,
      byStatus: statusCounts,
      awaitingPayment: countOf('PENDING_PAYMENT'),
      toProcess: countOf('PAID') + countOf('PROCESSING'),
      toShip: countOf('PACKING'),
      last30Days: orders30,
    },
    products: {
      total: products,
      active: activeProducts,
      variants,
      outOfStock: Number(outOfStock[0]?.count ?? 0),
    },
    inventory: {
      lowStock: Number(lowStock[0]?.count ?? 0),
      totalUnits: inventorySum._sum.quantity ?? 0,
      reservedUnits: inventorySum._sum.reservedQuantity ?? 0,
    },
    customers: { total: customers, newLast30Days: newCustomers },
    topProducts: topItems.flatMap((item) => {
      const product = item.productId === null ? undefined : nameById.get(item.productId);
      if (!product) return [];

      return [
        {
          productId: product.id,
          name: product.name,
          slug: product.slug,
          quantity: item._sum.quantity ?? 0,
          revenue: toNumber(item._sum.lineTotal),
        },
      ];
    }),
    generatedAt: new Date().toISOString(),
  };
}
