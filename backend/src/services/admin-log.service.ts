import { getPrisma, type Prisma } from '@teenstyle/database';
import ExcelJS from 'exceljs';

import {
  ACTION_GROUP_LABELS,
  actionLabelOf,
  ADMIN_LOG_SELECT,
  aliasesOf,
  canonicalTargetType,
  targetLabelOf,
  toAdminLogDto,
  type ActionGroup,
  type AdminLogDto,
  type TargetType,
} from '../models/admin-log.model.ts';
import { zonedDayEnd, zonedDayStart } from '../models/analytics.model.ts';
import {
  extensionFor,
  mimeTypeFor,
  styleWorksheet,
  workbookToBuffer,
  type ExportResult,
} from '../models/spreadsheet.ts';
import type {
  AdminLogExportQuery,
  AdminLogFilterQuery,
  AdminLogQuery,
} from '../validators/admin-log.validator.ts';

/**
 * อ่าน Audit log (STEP 27)
 *
 * กฎที่ห้ามละเมิด
 *
 *   1. **อ่านอย่างเดียว** — ไม่มี endpoint สร้าง/แก้/ลบ log โดยเจตนา
 *      audit log ที่ลบได้คือ audit log ที่เชื่อไม่ได้ (แพตเทิร์นเดียวกับประวัติสต็อก STEP 15 ข้อ 7)
 *
 *   2. **ตัวเลือกในตัวกรองต้องมาจากข้อมูลจริงในช่วงที่เลือก** — ไม่ใช่รายการคงที่ในโค้ด
 *      ถ้าโชว์ action ที่ไม่เคยเกิดขึ้น คนกดแล้วได้หน้าว่างจะคิดว่าระบบพัง
 *      (แพตเทิร์นเดียวกับตัวเลขข้างตัวกรองของ `/shop` STEP 6)
 *
 *   3. **กรอง `targetType` ต้องรวมชื่อเก่าทุกแบบ** ผ่าน `aliasesOf()`
 *      ไม่งั้นแถวที่เขียนด้วยชื่อเดิม (`KNOWLEDGE_ARTICLE`) จะหายไปเงียบ ๆ
 *      ซึ่งอันตรายกว่าไม่มีหน้า audit เลย
 *
 *   4. **ตัดวันตามเวลาร้าน** ผ่าน `zonedDayStart/End` (ดูเหตุผลใน analytics.model.ts)
 *
 *   5. **แถวที่เจ้าของถูกลบบัญชีไปแล้วต้องยังแสดง** — การซ่อนคือการทำให้ประวัติหาย
 */

function whereOf(query: {
  q?: string | undefined;
  group?: ActionGroup | undefined;
  action?: string | undefined;
  targetType?: TargetType | undefined;
  targetId?: string | undefined;
  userId?: string | undefined;
  from: string;
  to: string;
}): Prisma.AdminLogWhereInput {
  const where: Prisma.AdminLogWhereInput = {
    createdAt: { gte: zonedDayStart(query.from), lte: zonedDayEnd(query.to) },
  };

  if (query.action !== undefined && query.action !== '') {
    where.action = query.action;
  } else if (query.group !== undefined) {
    // กลุ่มคือคำนำหน้าของชื่อ action เช่น "product." ครอบ product.create / product.update / …
    where.action = { startsWith: `${query.group}.` };
  }

  if (query.targetType !== undefined) {
    // ⚠️ ต้อง `in` ทุก alias ไม่ใช่เทียบตรง ๆ (ดูกฎข้อ 3 ด้านบน)
    where.targetType = { in: aliasesOf(query.targetType) };
  }

  if (query.targetId !== undefined && query.targetId !== '') {
    where.targetId = query.targetId;
  }

  if (query.userId !== undefined) {
    where.userId = query.userId;
  }

  if (query.q !== undefined && query.q !== '') {
    where.OR = [
      { targetId: { contains: query.q, mode: 'insensitive' } },
      { action: { contains: query.q, mode: 'insensitive' } },
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
      { user: { name: { contains: query.q, mode: 'insensitive' } } },
    ];
  }

  return where;
}

/**
 * เลขคำสั่งซื้อของ log ที่ targetType เป็น Order
 *
 * `targetId` ของออเดอร์เก็บเป็น `id` แต่หน้าเว็บหลังบ้านเปิดด้วย `orderNumber`
 * ถ้าไม่แปลงจะได้ลิงก์ที่พาไป 404 — ซึ่งห้ามเกิด (กฎเดียวกับ STEP 24 ข้อ 10)
 */
async function orderNumbersFor(
  rows: Array<{ targetType: string | null; targetId: string | null }>,
) {
  const ids = rows
    .filter((row) => canonicalTargetType(row.targetType) === 'Order' && row.targetId !== null)
    .map((row) => row.targetId!);

  if (ids.length === 0) return new Map<string, string>();

  const orders = await getPrisma().order.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, orderNumber: true },
  });

  return new Map(orders.map((order) => [order.id, order.orderNumber]));
}

export interface AdminLogListResultDto {
  items: AdminLogDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  range: { from: string; to: string };
}

export async function listAdminLogs(query: AdminLogQuery): Promise<AdminLogListResultDto> {
  const prisma = getPrisma();
  const where = whereOf(query);

  const [rows, total] = await Promise.all([
    prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_LOG_SELECT,
    }),
    prisma.adminLog.count({ where }),
  ]);

  const orderNumbers = await orderNumbersFor(rows);

  return {
    items: rows.map((row) => toAdminLogDto(row, orderNumbers)),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
    range: { from: query.from, to: query.to },
  };
}

export interface AdminLogFiltersDto {
  /** เฉพาะ action ที่เกิดขึ้นจริงในช่วงนี้ พร้อมจำนวน */
  actions: { value: string; label: string; count: number }[];
  groups: { value: ActionGroup; label: string; count: number }[];
  targetTypes: { value: TargetType; label: string; count: number }[];
  /** พนักงานที่มีรายการในช่วงนี้ — รวมคนที่ถูกลบบัญชีแล้วเป็นรายการเดียว */
  actors: { userId: string | null; name: string | null; email: string; count: number }[];
  total: number;
  range: { from: string; to: string };
}

/**
 * ตัวเลือกของตัวกรอง — นับจากข้อมูลจริงในช่วงที่เลือกเท่านั้น
 *
 * ⚠️ นับ `targetType` แล้วยุบชื่อเก่าเข้ากับชื่อมาตรฐาน ไม่งั้นรายการตัวกรอง
 *    จะมี "คลังความรู้ AI" โผล่สองอันด้วยเลขคนละตัว
 */
export async function getAdminLogFilters(query: AdminLogFilterQuery): Promise<AdminLogFiltersDto> {
  const prisma = getPrisma();
  const where: Prisma.AdminLogWhereInput = {
    createdAt: { gte: zonedDayStart(query.from), lte: zonedDayEnd(query.to) },
  };

  const [byAction, byTarget, byUser, total] = await Promise.all([
    prisma.adminLog.groupBy({ by: ['action'], where, _count: { _all: true } }),
    prisma.adminLog.groupBy({ by: ['targetType'], where, _count: { _all: true } }),
    prisma.adminLog.groupBy({ by: ['userId'], where, _count: { _all: true } }),
    prisma.adminLog.count({ where }),
  ]);

  const actions = byAction
    .map((row) => ({ value: row.action, label: actionLabelOf(row.action), count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  // กลุ่มคิดจากคำนำหน้าของ action ที่เกิดขึ้นจริง
  const groupCounts = new Map<ActionGroup, number>();
  for (const row of byAction) {
    const group = (Object.keys(ACTION_GROUP_LABELS) as ActionGroup[]).find((candidate) =>
      row.action.startsWith(`${candidate}.`),
    );
    if (group === undefined) continue;
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + row._count._all);
  }

  const targetCounts = new Map<TargetType, number>();
  for (const row of byTarget) {
    const type = canonicalTargetType(row.targetType);
    if (type === null) continue;
    targetCounts.set(type, (targetCounts.get(type) ?? 0) + row._count._all);
  }

  const userIds = byUser.map((row) => row.userId).filter((id): id is string => id !== null);

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    actions,
    groups: [...groupCounts.entries()]
      .map(([value, count]) => ({ value, label: ACTION_GROUP_LABELS[value], count }))
      .sort((a, b) => b.count - a.count),
    targetTypes: [...targetCounts.entries()]
      .map(([value, count]) => ({ value, label: targetLabelOf(value, value), count }))
      .sort((a, b) => b.count - a.count),
    actors: byUser
      .map((row) => {
        const user = row.userId === null ? undefined : userById.get(row.userId);

        return {
          userId: row.userId,
          name: user?.name ?? null,
          // แถวที่เจ้าของถูกลบบัญชีแล้วต้องยังอยู่ในรายการ ไม่ใช่หายไป
          email: user?.email ?? '(บัญชีถูกลบแล้ว)',
          count: row._count._all,
        };
      })
      .sort((a, b) => b.count - a.count),
    total,
    range: { from: query.from, to: query.to },
  };
}

/**
 * ประวัติทั้งหมดของสิ่งใดสิ่งหนึ่ง (เช่น คำสั่งซื้อใบนี้ถูกใครแตะบ้าง)
 *
 * ไม่จำกัดช่วงเวลา เพราะเป็นการดูของชิ้นเดียว — และจำกัดจำนวนแถวไว้ที่ 200
 * ซึ่งมากพอสำหรับของหนึ่งชิ้นจริง ๆ แต่ไม่เปิดช่องให้ดึงทั้งตาราง
 */
export async function getTargetHistory(
  targetType: TargetType,
  targetId: string,
): Promise<{ items: AdminLogDto[]; total: number; truncated: boolean }> {
  const prisma = getPrisma();
  const where: Prisma.AdminLogWhereInput = {
    targetType: { in: aliasesOf(targetType) },
    targetId,
  };

  const [rows, total] = await Promise.all([
    prisma.adminLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: ADMIN_LOG_SELECT,
    }),
    prisma.adminLog.count({ where }),
  ]);

  const orderNumbers = await orderNumbersFor(rows);

  return {
    items: rows.map((row) => toAdminLogDto(row, orderNumbers)),
    total,
    truncated: total > rows.length,
  };
}

/**
 * ส่งออกประวัติเป็นไฟล์ (STEP 27)
 *
 * ⚠️ ใช้ `listAdminLogs` ตัวเดียวกับหน้าเว็บ เพื่อให้ไฟล์ตรงกับสิ่งที่เห็นบนจอเสมอ
 *    (กฎเดียวกับรายงานยอดขาย STEP 26 ข้อ 9)
 *
 * ⚠️ ไฟล์นี้มี IP และ User-Agent ซึ่งเป็นข้อมูลส่วนบุคคล — ต้องมีสิทธิ์ `log:read`
 *    และ **นโยบายระยะเวลาเก็บเป็นงานของ STEP 53**
 */
const EXPORT_LIMIT = 1000;

export async function exportAdminLogs(query: AdminLogExportQuery): Promise<ExportResult> {
  const result = await listAdminLogs({ ...query, page: 1, limit: EXPORT_LIMIT });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ประวัติการแก้ไข');

  sheet.columns = [
    { header: 'เวลา', key: 'at' },
    { header: 'ผู้ทำรายการ', key: 'actor' },
    { header: 'บทบาท', key: 'role' },
    { header: 'การกระทำ', key: 'action' },
    { header: 'ชนิดข้อมูล', key: 'targetType' },
    { header: 'รหัสข้อมูล', key: 'targetId' },
    { header: 'สิ่งที่เปลี่ยน', key: 'changes' },
    { header: 'IP', key: 'ip' },
  ];

  for (const item of result.items) {
    sheet.addRow({
      at: new Date(item.createdAt).toISOString(),
      actor: item.actor.name ?? item.actor.email,
      role: item.actor.role ?? '',
      action: item.actionLabel,
      targetType: item.targetTypeLabel,
      targetId: item.targetId ?? '',
      changes: item.changes
        .map((change) => `${change.field}: ${change.before ?? '—'} → ${change.after ?? '—'}`)
        .join('\n'),
      ip: item.ipAddress ?? '',
    });
  }

  styleWorksheet(sheet);

  return {
    buffer: await workbookToBuffer(workbook, query.format),
    filename: `admin_logs_${query.from}_to_${query.to}.${extensionFor(query.format)}`,
    mimeType: mimeTypeFor(query.format),
  };
}
