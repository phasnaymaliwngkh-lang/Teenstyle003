import { getPrisma, type Prisma } from '@teenstyle/database';

import {
  ADDRESS_SELECT,
  ADMIN_CUSTOMER_SELECT,
  EMPTY_ORDER_STATS,
  ROLE_RANK,
  toAdminCustomerDetail,
  toAdminCustomerListItem,
  type AdminCustomerDetailDto,
  type AdminCustomerListItemDto,
  type CustomerOrderStats,
  type RoleNameCode,
} from '../models/customer.model.ts';
import { toNumber } from '../models/pricing.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  AdminCustomerQuery,
  UpdateCustomerRoleInput,
  UpdateCustomerStatusInput,
} from '../validators/customer.validator.ts';

/**
 * จัดการลูกค้าและบัญชีผู้ใช้จากหลังบ้าน (STEP 25)
 *
 * กฎที่ห้ามละเมิด
 *
 *   1. **ยอดซื้อนับจากตาราง `Order` จริงเท่านั้น** — ห้ามอ่านคอลัมน์ `User.totalSpent`
 *      ซึ่งยังไม่มีใครเขียน (เป็น 0 ทุกคน · จะมาพร้อมระบบแต้ม STEP 42)
 *      และ "ยอดที่ได้รับ" นับเฉพาะ `paymentStatus = PAID` ส่วน COD ที่ยังไม่เก็บเงิน
 *      แยกเป็นอีกช่อง (เกณฑ์เดียวกับ dashboard STEP 13 ข้อ 6)
 *
 *   2. **ห้ามแก้บัญชีตัวเอง** — ทั้งสถานะและบทบาท
 *      ระงับตัวเองคือการล็อกตัวเองออกจากร้าน ลดบทบาทตัวเองคือการทิ้งกุญแจ
 *
 *   3. **แตะได้แค่บัญชีที่บทบาทต่ำกว่าตัวเอง** (SUPER_ADMIN แตะได้ทุกคนยกเว้นตัวเอง)
 *      ไม่งั้น ADMIN คนหนึ่งระงับ ADMIN อีกคนได้ → แย่งกันล็อกออก
 *
 *   4. **ตั้งบทบาทได้ไม่เกินระดับตัวเอง** (SUPER_ADMIN ตั้ง SUPER_ADMIN ได้)
 *      ถ้า ADMIN ตั้งใครเป็น ADMIN ได้ ก็เท่ากับยกระดับสิทธิ์ตัวเองผ่านบัญชีที่สร้างขึ้นมา
 *
 *   5. **ระงับ/แบน = เพิกถอน session ทั้งหมดของบัญชีนั้นในทรานแซกชันเดียวกัน**
 *      ตอนนี้ทั้ง `dal.ts` และ `findUserBySessionToken` ตรวจ `status` อยู่แล้ว
 *      แต่การลบแถว `Session` ทำให้การเพิกถอนไม่ต้องพึ่งว่าโค้ดทุกจุดในอนาคตจะจำตรวจ
 *
 *   6. **ทุกการเปลี่ยนสถานะ/บทบาทเขียน `AdminLog` ในทรานแซกชันเดียวกัน** พร้อมเหตุผลที่กรอก
 *      (กฎเดียวกับ STEP 13/14/15/21/23)
 *
 *   7. **ไม่มี endpoint ลบลูกค้า** — การลบข้อมูลส่วนบุคคลมีผลทางกฎหมายและต้องพาข้อมูล
 *      ที่ผูกอยู่ (คำสั่งซื้อ ใบเสร็จ) ไปด้วย เป็นงานของ STEP 53
 *      เครื่องมือที่ใช้ตัดคนออกจากร้านคือการระงับบัญชี
 *
 *   8. **เปลี่ยนบทบาทแล้วมีผลทันทีโดยไม่ต้องเพิกถอน session** — ทั้ง Auth.js callback
 *      และ backend อ่าน role + permissions จากฐานข้อมูลใหม่ทุกคำขอ (ไม่ได้ฝังใน token)
 */

export interface CustomerActor {
  id: string;
  role: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** ออเดอร์ที่นับเป็น "ได้รับเงินแล้ว" — เกณฑ์เดียวกับหน้า dashboard */
const PAID_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  paymentStatus: 'PAID',
  status: { notIn: ['CANCELLED', 'REFUNDED'] },
};

/** COD ที่ยืนยันแล้วแต่เงินยังไม่ถึงมือร้าน — ห้ามรวมกับยอดขาย */
const PENDING_COD_WHERE: Prisma.OrderWhereInput = {
  deletedAt: null,
  paymentStatus: 'PENDING',
  status: { in: ['PROCESSING', 'PACKING', 'SHIPPING'] },
};

const SORT_ORDER: Record<
  AdminCustomerQuery['sort'],
  Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[]
> = {
  recent: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  name: [{ name: 'asc' }, { email: 'asc' }],
  // คนที่ไม่เคยล็อกอินไปท้ายสุด (nulls last) เพื่อให้หัวรายการเป็นคนที่ใช้งานจริง
  lastLogin: { lastLoginAt: { sort: 'desc', nulls: 'last' } },
};

/**
 * ยอดซื้อของผู้ใช้หลายคนในคราวเดียว — 3 คิวรีคงที่ ไม่ใช่คิวรีต่อคน
 * (ถ้ายิงต่อคน หน้ารายการ 20 แถวจะกลายเป็น 60 คิวรี)
 */
async function statsFor(userIds: string[]): Promise<Map<string, CustomerOrderStats>> {
  const result = new Map<string, CustomerOrderStats>();
  if (userIds.length === 0) return result;

  const prisma = getPrisma();
  const scope = { userId: { in: userIds } };

  const [all, paid, cod] = await Promise.all([
    prisma.order.groupBy({
      by: ['userId'],
      where: { ...scope, deletedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.order.groupBy({
      by: ['userId'],
      where: { ...scope, ...PAID_WHERE },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.order.groupBy({
      by: ['userId'],
      where: { ...scope, ...PENDING_COD_WHERE },
      _sum: { total: true },
    }),
  ]);

  for (const userId of userIds) {
    result.set(userId, { ...EMPTY_ORDER_STATS });
  }

  for (const row of all) {
    const entry = result.get(row.userId);
    if (!entry) continue;
    entry.totalOrders = row._count._all;
    entry.lastOrderAt = row._max.createdAt?.toISOString() ?? null;
  }

  for (const row of paid) {
    const entry = result.get(row.userId);
    if (!entry) continue;
    entry.paidOrders = row._count._all;
    entry.totalPaid = toNumber(row._sum.total);
  }

  for (const row of cod) {
    const entry = result.get(row.userId);
    if (!entry) continue;
    entry.pendingCodAmount = toNumber(row._sum.total);
  }

  return result;
}

export interface AdminCustomerListResultDto {
  items: AdminCustomerListItemDto[];
  /** ตัวเลขสรุปของ **ทั้งระบบ** ไม่ใช่ของหน้าปัจจุบัน */
  counts: {
    customers: number;
    staff: number;
    suspended: number;
    newLast30Days: number;
  };
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function adminListCustomers(
  query: AdminCustomerQuery,
): Promise<AdminCustomerListResultDto> {
  const prisma = getPrisma();

  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (query.status !== undefined) where.status = query.status;
  if (query.tier !== undefined) where.loyaltyTier = query.tier;
  if (query.role !== undefined) where.role = { name: query.role };

  if (query.q !== undefined && query.q.length > 0) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
      { phone: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [rows, total, customers, staff, suspended, newLast30Days] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: SORT_ORDER[query.sort],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_CUSTOMER_SELECT,
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { deletedAt: null, role: { name: 'CUSTOMER' } } }),
    prisma.user.count({
      where: { deletedAt: null, role: { name: { in: ['EMPLOYEE', 'ADMIN', 'SUPER_ADMIN'] } } },
    }),
    prisma.user.count({ where: { deletedAt: null, status: { in: ['SUSPENDED', 'BANNED'] } } }),
    prisma.user.count({
      where: { deletedAt: null, role: { name: 'CUSTOMER' }, createdAt: { gte: thirtyDaysAgo } },
    }),
  ]);

  const stats = await statsFor(rows.map((row) => row.id));

  return {
    items: rows.map((row) =>
      toAdminCustomerListItem(row, stats.get(row.id) ?? { ...EMPTY_ORDER_STATS }),
    ),
    counts: { customers, staff, suspended, newLast30Days },
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function adminGetCustomer(userId: string): Promise<AdminCustomerDetailDto> {
  const prisma = getPrisma();

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: ADMIN_CUSTOMER_SELECT,
  });

  if (!user) {
    throw ApiError.notFound('ไม่พบบัญชีผู้ใช้นี้');
  }

  const [addresses, recentOrders, reviewCount, wishlistCount, activeSessions, stats] =
    await Promise.all([
      prisma.address.findMany({
        where: { userId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        select: ADDRESS_SELECT,
      }),
      prisma.order.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          orderNumber: true,
          status: true,
          paymentStatus: true,
          total: true,
          createdAt: true,
        },
      }),
      prisma.review.count({ where: { userId, deletedAt: null } }),
      prisma.wishlist.count({ where: { userId } }),
      prisma.session.count({ where: { userId, expires: { gt: new Date() } } }),
      statsFor([userId]),
    ]);

  return toAdminCustomerDetail(user, {
    stats: stats.get(userId) ?? { ...EMPTY_ORDER_STATS },
    addresses,
    recentOrders,
    reviewCount,
    wishlistCount,
    activeSessions,
  });
}

/** บทบาทของผู้ทำรายการ — ค่าที่ไม่รู้จักถือว่าต่ำสุด (ปฏิเสธไว้ก่อน) */
function rankOf(role: string): number {
  return ROLE_RANK[role as RoleNameCode] ?? -1;
}

/**
 * ด่านกลางของทุกการแก้บัญชีผู้อื่น
 *
 * คืนแถวเป้าหมาย หรือโยน error ที่บอกเหตุผลตรง ๆ
 * (ตรวจ **ก่อน** เขียนอะไรทั้งสิ้น และอยู่ในทรานแซกชันเดียวกับการเขียน)
 */
async function assertCanManage(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  actor: CustomerActor,
): Promise<{
  id: string;
  email: string;
  name: string | null;
  status: string;
  roleName: string;
}> {
  if (targetUserId === actor.id) {
    throw ApiError.badRequest(
      'แก้บัญชีของตัวเองจากหน้านี้ไม่ได้ — ให้ผู้ดูแลอีกคนทำให้ เพื่อกันล็อกตัวเองออกจากระบบ',
    );
  }

  const target = await tx.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { id: true, email: true, name: true, status: true, role: { select: { name: true } } },
  });

  if (!target) {
    throw ApiError.notFound('ไม่พบบัญชีผู้ใช้นี้');
  }

  const actorRank = rankOf(actor.role);
  const targetRank = rankOf(target.role.name);

  // SUPER_ADMIN จัดการได้ทุกบัญชี (ยกเว้นของตัวเอง ซึ่งถูกกันไปด้านบนแล้ว)
  if (actor.role !== 'SUPER_ADMIN' && targetRank >= actorRank) {
    throw ApiError.forbidden(
      `บัญชีนี้มีบทบาท ${target.role.name} ซึ่งไม่ต่ำกว่าคุณ — ต้องให้ผู้ดูแลระดับสูงกว่าจัดการ`,
    );
  }

  return {
    id: target.id,
    email: target.email,
    name: target.name,
    status: target.status,
    roleName: target.role.name,
  };
}

export async function adminUpdateCustomerStatus(
  userId: string,
  input: UpdateCustomerStatusInput,
  actor: CustomerActor,
): Promise<AdminCustomerDetailDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const target = await assertCanManage(tx, userId, actor);

    if (target.status === input.status) {
      throw ApiError.conflict(`บัญชีนี้อยู่ในสถานะ ${input.status} อยู่แล้ว`);
    }

    await tx.user.update({ where: { id: userId }, data: { status: input.status } });

    /**
     * เพิกถอน session ที่ค้างอยู่ทั้งหมดเมื่อบัญชีถูกระงับ/แบน
     * การตรวจ `status` ที่ dal.ts และ backend กันไว้อยู่แล้ว — การลบแถวนี้คือด่านที่
     * ไม่ต้องพึ่งว่าโค้ดที่เขียนเพิ่มในอนาคตจะจำตรวจ (defence in depth)
     */
    const revoked =
      input.status === 'ACTIVE' ? { count: 0 } : await tx.session.deleteMany({ where: { userId } });

    await tx.adminLog.create({
      data: {
        userId: actor.id,
        action: 'customer.status.update',
        targetType: 'User',
        targetId: userId,
        before: { status: target.status } as Prisma.InputJsonValue,
        after: {
          status: input.status,
          reason: input.reason,
          revokedSessions: revoked.count,
        } as Prisma.InputJsonValue,
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      },
    });
  });

  return adminGetCustomer(userId);
}

export async function adminUpdateCustomerRole(
  userId: string,
  input: UpdateCustomerRoleInput,
  actor: CustomerActor,
): Promise<AdminCustomerDetailDto> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const target = await assertCanManage(tx, userId, actor);

    if (target.roleName === input.role) {
      throw ApiError.conflict(`บัญชีนี้มีบทบาท ${input.role} อยู่แล้ว`);
    }

    /**
     * ตั้งบทบาทได้ไม่เกินระดับตัวเอง — ถ้า ADMIN ตั้งใครเป็น ADMIN ได้
     * ก็เท่ากับยกระดับสิทธิ์ของตัวเองผ่านบัญชีอื่น (privilege escalation)
     */
    if (actor.role !== 'SUPER_ADMIN' && rankOf(input.role) >= rankOf(actor.role)) {
      throw ApiError.forbidden(
        `ตั้งบทบาท ${input.role} ไม่ได้เพราะไม่ต่ำกว่าบทบาทของคุณ — ต้องให้ผู้ดูแลระดับสูงกว่าทำ`,
      );
    }

    const role = await tx.role.findUnique({ where: { name: input.role }, select: { id: true } });

    if (!role) {
      // บทบาทอยู่ในฐานข้อมูล ไม่ได้ hard-code ในโค้ด — ถ้าไม่มีคือยังไม่ได้ seed
      throw ApiError.conflict(`ยังไม่มีบทบาท ${input.role} ในฐานข้อมูล — รัน npm run db:seed ก่อน`);
    }

    await tx.user.update({ where: { id: userId }, data: { roleId: role.id } });

    await tx.adminLog.create({
      data: {
        userId: actor.id,
        action: 'customer.role.update',
        targetType: 'User',
        targetId: userId,
        before: { role: target.roleName } as Prisma.InputJsonValue,
        after: { role: input.role, reason: input.reason } as Prisma.InputJsonValue,
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      },
    });
  });

  return adminGetCustomer(userId);
}
