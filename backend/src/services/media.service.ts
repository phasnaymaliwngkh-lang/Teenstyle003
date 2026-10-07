import { randomUUID } from 'node:crypto';

import { getPrisma, Prisma } from '@teenstyle/database';
import sharp, { type Metadata } from 'sharp';

import {
  ACCEPTED_IMAGE_TEXT,
  MEDIA_RULES,
  MEDIA_UNUSED_GRACE_HOURS,
  UPLOAD_LIMITS,
  type MediaPurposeKey,
} from '../config/media.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import { utcTs } from '../models/analytics.model.ts';
import {
  checkSourceImage,
  megabytes,
  mediaStorageKey,
  mediaUrlOf,
  type MediaAssetDto,
} from '../models/media.model.ts';
import { ApiError } from '../utils/api-error.ts';
import { logger } from '../utils/logger.ts';

import { removeMediaFile, writeMediaFile } from './media-storage.ts';

/**
 * รูปที่ร้านเก็บเอง (STEP 47)
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **ไม่เก็บไฟล์ที่ผู้ใช้ส่งมาตรง ๆ เลย** — ถอดรหัสแล้วเข้ารหัสใหม่เป็น WebP ทุกไฟล์
 *    ผลคือ metadata ทั้งหมดหายไป (EXIF รวม **พิกัด GPS ของบ้านลูกค้า** ที่ติดมากับรูปจากมือถือ ·
 *    รุ่นกล้อง · เวลาถ่าย) และไฟล์ที่ซ่อนของอื่นไว้ในเนื้อรูป (polyglot) ไม่มีทางรอดออกมา
 * 2. **ตัดสินชนิดไฟล์จากเนื้อไฟล์** ไม่ใช่นามสกุลหรือ mimetype ที่ผู้ใช้ส่งมา
 * 3. **เขียนไฟล์ก่อน แล้วค่อยเขียนฐานข้อมูล** — ทรานแซกชันล้มเมื่อไร ลบไฟล์ที่เพิ่งเขียนทิ้ง
 *    (กลับกันไม่ได้: ฐานข้อมูลชี้ไปไฟล์ที่ยังไม่มี = รูปแตกให้ลูกค้าเห็น)
 * 4. **ไม่ลบไฟล์ทันทีที่เลิกใช้** — url ถูกคัดลอกไปเป็น snapshot ของคำสั่งซื้อ
 *    ลบได้เฉพาะไฟล์ที่ไม่มีที่ไหนใช้ต่อเนื่องเกิน `MEDIA_UNUSED_GRACE_HOURS` (mark & sweep)
 */

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
}

/** ตรวจ + ย่อ + หมุนตาม EXIF + ตัด metadata + แปลงเป็น WebP */
export async function processImage(
  buffer: Buffer,
  purpose: MediaPurposeKey,
): Promise<ProcessedImage> {
  if (buffer.length === 0) {
    throw ApiError.badRequest('ไฟล์ว่างเปล่า — กรุณาเลือกรูปใหม่');
  }

  // multer ตัดไว้ก่อนแล้ว — ตรงนี้กันกรณีที่มีคนเรียกฟังก์ชันนี้จากทางอื่น
  if (buffer.length > UPLOAD_LIMITS.maxBytes) {
    throw ApiError.payloadTooLarge(
      `รูปมีขนาดใหญ่เกินกำหนด (สูงสุด ${megabytes(UPLOAD_LIMITS.maxBytes)})`,
    );
  }

  let info: Metadata;
  try {
    // อ่านแค่หัวไฟล์ ยังไม่ถอดรหัสทั้งรูป — ไฟล์ที่ไม่ใช่รูปล้มตรงนี้
    info = await sharp(buffer).metadata();
  } catch {
    throw ApiError.badRequest(
      `ไฟล์นี้ไม่ใช่รูปที่ระบบรองรับ — กรุณาส่งเป็น ${ACCEPTED_IMAGE_TEXT}`,
    );
  }

  const problem = checkSourceImage(info, purpose);
  if (problem !== null) {
    throw ApiError.badRequest(problem);
  }

  const rule = MEDIA_RULES[purpose];

  try {
    const { data, info: output } = await sharp(buffer, {
      limitInputPixels: UPLOAD_LIMITS.maxInputPixels,
    })
      // หมุนตาม EXIF orientation ก่อน เพราะ metadata (รวม orientation) จะถูกตัดทิ้งตอนเขียน
      // ถ้าไม่หมุน รูปที่ถ่ายแนวตั้งจากมือถือจะนอนตะแคง
      .rotate()
      .resize({
        width: rule.maxLongEdge,
        height: rule.maxLongEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // sharp ไม่ใส่ metadata ของต้นฉบับลงไฟล์ใหม่ถ้าไม่ได้สั่ง keepMetadata/withMetadata
      .webp({ quality: rule.quality })
      .toBuffer({ resolveWithObject: true });

    return {
      data,
      width: output.width,
      height: output.height,
      bytes: data.length,
      originalBytes: buffer.length,
    };
  } catch {
    throw ApiError.badRequest('อ่านเนื้อรูปไม่สำเร็จ — ไฟล์อาจเสียหายหรือส่งมาไม่ครบ');
  }
}

export interface StoredImage extends MediaAssetDto {
  storageKey: string;
}

/**
 * เก็บรูปแล้วผูกกับของชิ้นอื่นในทรานแซกชันเดียวกับแถว `MediaAsset`
 *
 * `attach` ทำงานในทรานแซกชันเดียวกัน — โยน error = ไม่มีทั้งแถวและไฟล์เหลืออยู่
 * (ใช้กับการตรวจที่ต้องล็อกแถวก่อน เช่น จำนวนรูปสูงสุดของสินค้า)
 */
export async function storeImage<T>(
  input: { buffer: Buffer; purpose: MediaPurposeKey; uploaderId: string | null },
  attach: (tx: Prisma.TransactionClient, image: StoredImage) => Promise<T>,
): Promise<T> {
  const processed = await processImage(input.buffer, input.purpose);

  const id = randomUUID();
  const createdAt = new Date();
  const storageKey = mediaStorageKey(input.purpose, id, createdAt);
  const url = mediaUrlOf(storageKey);

  await writeMediaFile(storageKey, processed.data);

  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.mediaAsset.create({
        data: {
          id,
          purpose: input.purpose,
          storageKey,
          url,
          mimeType: 'image/webp',
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
          originalBytes: processed.originalBytes,
          uploadedById: input.uploaderId,
          createdAt,
        },
      });

      return attach(tx, {
        id,
        url,
        storageKey,
        purpose: input.purpose,
        width: processed.width,
        height: processed.height,
        bytes: processed.bytes,
        originalBytes: processed.originalBytes,
        createdAt: createdAt.toISOString(),
      });
    });
  } catch (error) {
    await removeMediaFile(storageKey).catch((cleanupError: unknown) => {
      logger.warn({ err: cleanupError, storageKey }, 'ลบไฟล์รูปที่บันทึกไม่สำเร็จไม่ได้');
    });
    throw error;
  }
}

/* ─────────────────────────── ไฟล์ไหนยังถูกใช้อยู่ ─────────────────────────── */

/**
 * ทุก url ของไฟล์ที่ร้านเก็บเองซึ่งยังมีที่ไหนใช้อยู่
 *
 * ⚠️ **เพิ่มที่ที่เก็บ url ของรูปแห่งใหม่เมื่อไร ต้องเพิ่มขาที่นี่ด้วย** ไม่งั้นตัวล้างไฟล์
 *    จะลบไฟล์ที่ยังถูกใช้อยู่ (มีเทสต์ไล่ทุกขา)
 *    - `OrderItem.imageUrl` — snapshot ตอนสั่งซื้อ: รูปที่ถอดออกจากสินค้าแล้วยังต้องอยู่
 *    - รีวิวที่ลูกค้าลบแล้วไม่นับ — ลูกค้าลบรีวิวพร้อมรูป รูปต้องหายตาม
 *    - สินค้าที่ถูกลบ (soft delete) ยังนับ เพราะลบแบบซ่อนแล้วข้อมูลยังอ้างถึงได้
 *    - หมวดหมู่ ลุค รูปโปรไฟล์ ยังไม่มีทางอัปโหลด แต่นับไว้ก่อนเพื่อไม่ให้วันที่เพิ่มแล้วลืม
 *
 * ⚠️ **ใช้กับ `LEFT JOIN used u ON u.url = a.url` เท่านั้น ห้าม `EXISTS (SELECT … FROM used …)`**
 *    PostgreSQL inline CTE เข้าไปใน subquery แล้วคำนวณ UNION ทั้ง 6 ตารางใหม่ **ทีละไฟล์**
 *    (กฎ STEP 34 ข้อ 1) — วัดจริงตอน STEP 47 ที่ 5,461 ไฟล์ · 120,000 รายการในบิล: คิวรีรันเกิน
 *    2 นาที 23 วินาทียังไม่เสร็จ (audit-performance ค้าง) · เขียนเป็น LEFT JOIN แล้ว 121ms
 *    (hash join รอบเดียว) · `UNION` (ไม่ใช่ UNION ALL) ทำให้ url ไม่ซ้ำ
 *    การ join จึงไม่ทำให้แถวของไฟล์ซ้ำ
 */
function usedMediaUrlsSql(only?: readonly string[]): Prisma.Sql {
  const match = (column: Prisma.Sql): Prisma.Sql =>
    only === undefined
      ? Prisma.sql`${column} LIKE '/media/%'`
      : Prisma.sql`${column} = ANY(${[...only]}::text[])`;

  return Prisma.sql`
    SELECT pi."url" AS url FROM "ProductImage" pi WHERE ${match(Prisma.sql`pi."url"`)}
    UNION SELECT oi."imageUrl" FROM "OrderItem" oi WHERE ${match(Prisma.sql`oi."imageUrl"`)}
    UNION SELECT img FROM "Review" r CROSS JOIN LATERAL unnest(r."images") AS img
      WHERE r."deletedAt" IS NULL AND ${match(Prisma.sql`img`)}
    UNION SELECT c."imageUrl" FROM "Category" c WHERE ${match(Prisma.sql`c."imageUrl"`)}
    UNION SELECT l."imageUrl" FROM "Look" l WHERE ${match(Prisma.sql`l."imageUrl"`)}
    UNION SELECT u."image" FROM "User" u WHERE ${match(Prisma.sql`u."image"`)}
  `;
}

/** url ไหนในรายการนี้ที่ยังถูกใช้อยู่ */
async function usedAmong(
  db: Prisma.TransactionClient | ReturnType<typeof getPrisma>,
  urls: readonly string[],
): Promise<Set<string>> {
  if (urls.length === 0) return new Set();

  const rows = await db.$queryRaw<Array<{ url: string }>>(usedMediaUrlsSql(urls));
  return new Set(rows.map((row) => row.url));
}

/**
 * เรียกในทรานแซกชันที่ถอดรูปออกจากของชิ้นใดชิ้นหนึ่ง — เริ่มนับเวลาผ่อนผันของไฟล์ที่ไม่มีใครใช้แล้ว
 *
 * ไฟล์ที่ยังถูกใช้ที่อื่น (เช่น snapshot ของคำสั่งซื้อ) ไม่ถูกแตะ
 */
export async function markIfUnused(
  tx: Prisma.TransactionClient,
  urls: readonly string[],
): Promise<void> {
  if (urls.length === 0) return;

  const used = await usedAmong(tx, urls);
  const unused = urls.filter((url) => !used.has(url));
  if (unused.length === 0) return;

  await tx.mediaAsset.updateMany({
    where: { url: { in: unused }, unusedSince: null },
    data: { unusedSince: new Date() },
  });
}

/**
 * ตรวจทุกไฟล์แล้วปรับ `unusedSince` ให้ตรงกับความจริง (mark)
 * — ไฟล์ที่เลิกใช้เริ่มนับเวลา · ไฟล์ที่กลับมาถูกใช้ (หรือถูกจดผิด) ล้างค่ากลับเป็น null
 */
async function refreshUnusedMarks(): Promise<void> {
  const prisma = getPrisma();

  const rows = await prisma.$queryRaw<Array<{ id: string; inUse: boolean; marked: boolean }>>(
    Prisma.sql`
      WITH used AS (${usedMediaUrlsSql()})
      SELECT a."id", u.url IS NOT NULL AS "inUse", a."unusedSince" IS NOT NULL AS "marked"
      FROM "MediaAsset" a
      LEFT JOIN used u ON u.url = a."url"
    `,
  );

  const toMark = rows.filter((row) => !row.inUse && !row.marked).map((row) => row.id);
  const toClear = rows.filter((row) => row.inUse && row.marked).map((row) => row.id);

  if (toMark.length > 0) {
    await prisma.mediaAsset.updateMany({
      where: { id: { in: toMark }, unusedSince: null },
      data: { unusedSince: new Date() },
    });
  }

  if (toClear.length > 0) {
    await prisma.mediaAsset.updateMany({
      where: { id: { in: toClear } },
      data: { unusedSince: null },
    });
  }
}

function graceThreshold(now = Date.now()): Date {
  return new Date(now - MEDIA_UNUSED_GRACE_HOURS * 60 * 60 * 1000);
}

/* ─────────────────────────── คลังรูป (หลังบ้าน) ─────────────────────────── */

export type MediaUsageFilter = 'all' | 'in-use' | 'unused';

export interface MediaLibraryQuery {
  purpose: MediaPurposeKey | null;
  usage: MediaUsageFilter;
  page: number;
  limit: number;
}

export interface MediaUsageDto {
  products: { id: string; name: string; archived: boolean }[];
  /** จำนวนรายการในคำสั่งซื้อที่เก็บรูปนี้เป็น snapshot */
  orderItemCount: number;
  reviews: { id: string; status: string; productName: string }[];
}

export interface MediaLibraryItemDto extends MediaAssetDto {
  uploadedBy: { id: string; name: string | null; email: string } | null;
  inUse: boolean;
  unusedSince: string | null;
  /** เวลาที่ไฟล์ที่ไม่ได้ใช้นี้จะลบได้ — null = ยังถูกใช้อยู่ หรือยังไม่เคยถูกตรวจพบว่าเลิกใช้ */
  deletableAt: string | null;
  /** ลบได้ตอนกดล้างครั้งนี้ */
  deletable: boolean;
  usage: MediaUsageDto;
}

export interface MediaSummaryDto {
  total: number;
  totalBytes: number;
  /** ขนาดรวมของไฟล์ที่ผู้ใช้ส่งมา ก่อนแปลง */
  originalBytes: number;
  inUse: number;
  unused: number;
  /** ไม่ได้ใช้และพ้นช่วงผ่อนผันแล้ว — ลบได้เลย */
  deletable: number;
  deletableBytes: number;
  graceHours: number;
}

export interface MediaLibraryDto {
  summary: MediaSummaryDto;
  items: MediaLibraryItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * ภาพรวมของไฟล์ทั้งหมด — **อ่านอย่างเดียว ไม่แตะ `unusedSince`**
 * (บทเรียนจาก STEP 46: การอ่านต้องไม่ใช่การแก้) การจดเวลาทำตอนถอดรูปและตอนกดล้างเท่านั้น
 */
async function mediaSummary(): Promise<MediaSummaryDto> {
  const threshold = graceThreshold();

  const [row] = await getPrisma().$queryRaw<
    Array<{
      total: bigint;
      totalBytes: bigint;
      originalBytes: bigint;
      inUse: bigint;
      deletable: bigint;
      deletableBytes: bigint;
    }>
  >(Prisma.sql`
    WITH used AS (${usedMediaUrlsSql()}),
    flagged AS (
      SELECT a."bytes", a."originalBytes", a."unusedSince", u.url IS NOT NULL AS in_use
      FROM "MediaAsset" a
      LEFT JOIN used u ON u.url = a."url"
    )
    SELECT count(*) AS "total",
           coalesce(sum("bytes"), 0) AS "totalBytes",
           coalesce(sum("originalBytes"), 0) AS "originalBytes",
           count(*) FILTER (WHERE in_use) AS "inUse",
           count(*) FILTER (WHERE NOT in_use AND "unusedSince" <= ${utcTs(threshold)}) AS "deletable",
           coalesce(sum("bytes") FILTER (WHERE NOT in_use AND "unusedSince" <= ${utcTs(threshold)}), 0)
             AS "deletableBytes"
    FROM flagged
  `);

  const total = Number(row?.total ?? 0);
  const inUse = Number(row?.inUse ?? 0);

  return {
    total,
    totalBytes: Number(row?.totalBytes ?? 0),
    originalBytes: Number(row?.originalBytes ?? 0),
    inUse,
    unused: total - inUse,
    deletable: Number(row?.deletable ?? 0),
    deletableBytes: Number(row?.deletableBytes ?? 0),
    graceHours: MEDIA_UNUSED_GRACE_HOURS,
  };
}

async function usageOf(urls: string[]): Promise<Map<string, MediaUsageDto>> {
  const prisma = getPrisma();
  const usage = new Map<string, MediaUsageDto>(
    urls.map((url) => [url, { products: [], orderItemCount: 0, reviews: [] }]),
  );

  if (urls.length === 0) return usage;

  const [productImages, orderItems, reviews] = await Promise.all([
    prisma.productImage.findMany({
      where: { url: { in: urls } },
      select: { url: true, product: { select: { id: true, name: true, deletedAt: true } } },
    }),
    prisma.orderItem.groupBy({
      by: ['imageUrl'],
      where: { imageUrl: { in: urls } },
      _count: { _all: true },
    }),
    prisma.review.findMany({
      where: { images: { hasSome: urls }, deletedAt: null },
      select: { id: true, status: true, images: true, product: { select: { name: true } } },
    }),
  ]);

  for (const row of productImages) {
    usage.get(row.url)?.products.push({
      id: row.product.id,
      name: row.product.name,
      archived: row.product.deletedAt !== null,
    });
  }

  for (const row of orderItems) {
    if (row.imageUrl === null) continue;
    const entry = usage.get(row.imageUrl);
    if (entry) entry.orderItemCount = row._count._all;
  }

  for (const review of reviews) {
    for (const url of review.images) {
      usage.get(url)?.reviews.push({
        id: review.id,
        status: review.status,
        productName: review.product.name,
      });
    }
  }

  return usage;
}

export async function getMediaLibrary(query: MediaLibraryQuery): Promise<MediaLibraryDto> {
  const prisma = getPrisma();
  const threshold = graceThreshold();

  const usageWhere =
    query.usage === 'in-use'
      ? Prisma.sql`AND u.url IS NOT NULL`
      : query.usage === 'unused'
        ? Prisma.sql`AND u.url IS NULL`
        : Prisma.empty;

  const purposeWhere =
    query.purpose === null
      ? Prisma.empty
      : Prisma.sql`AND a."purpose" = ${query.purpose}::"MediaPurpose"`;

  // กรองและแบ่งหน้าใน SQL เดียว — นับทั้งชุดด้วย count(*) OVER () (กฎ STEP 14 ข้อ 7)
  const [rows, summary] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        url: string;
        purpose: MediaPurposeKey;
        width: number;
        height: number;
        bytes: number;
        originalBytes: number;
        createdAt: Date;
        unusedSince: Date | null;
        uploadedById: string | null;
        inUse: boolean;
        total: bigint;
      }>
    >(Prisma.sql`
      WITH used AS (${usedMediaUrlsSql()})
      SELECT a."id", a."url", a."purpose", a."width", a."height", a."bytes", a."originalBytes",
             a."createdAt", a."unusedSince", a."uploadedById",
             u.url IS NOT NULL AS "inUse",
             count(*) OVER () AS "total"
      FROM "MediaAsset" a
      LEFT JOIN used u ON u.url = a."url"
      WHERE TRUE ${purposeWhere} ${usageWhere}
      ORDER BY a."createdAt" DESC, a."id" DESC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    `),
    mediaSummary(),
  ]);

  const uploaderIds = [
    ...new Set(rows.flatMap((row) => (row.uploadedById ? [row.uploadedById] : []))),
  ];
  const [usage, uploaders] = await Promise.all([
    usageOf(rows.map((row) => row.url)),
    prisma.user.findMany({
      where: { id: { in: uploaderIds } },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const uploaderById = new Map(uploaders.map((user) => [user.id, user]));

  const total = Number(rows[0]?.total ?? 0);

  return {
    summary,
    items: rows.map((row) => {
      const deletableAt =
        !row.inUse && row.unusedSince !== null
          ? new Date(row.unusedSince.getTime() + MEDIA_UNUSED_GRACE_HOURS * 60 * 60 * 1000)
          : null;

      return {
        id: row.id,
        url: row.url,
        purpose: row.purpose,
        width: row.width,
        height: row.height,
        bytes: row.bytes,
        originalBytes: row.originalBytes,
        createdAt: row.createdAt.toISOString(),
        uploadedBy: row.uploadedById ? (uploaderById.get(row.uploadedById) ?? null) : null,
        inUse: row.inUse,
        unusedSince: row.unusedSince?.toISOString() ?? null,
        deletableAt: deletableAt?.toISOString() ?? null,
        deletable: deletableAt !== null && row.unusedSince !== null && row.unusedSince <= threshold,
        usage: usage.get(row.url) ?? { products: [], orderItemCount: 0, reviews: [] },
      };
    }),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export interface MediaPurgeResult {
  deleted: number;
  freedBytes: number;
  /** ไฟล์ที่ไม่ได้ใช้แล้วแต่ยังอยู่ในช่วงผ่อนผัน — กดล้างอีกครั้งหลังเวลาผ่านไปแล้วจะลบได้ */
  waiting: number;
}

/** ลบได้ครั้งละไม่เกินนี้ — กันทรานแซกชันยาวและคำขอที่ค้างนาน กดซ้ำเพื่อลบส่วนที่เหลือ */
const PURGE_BATCH = 500;

/**
 * ลบไฟล์ที่ไม่มีที่ไหนใช้ต่อเนื่องเกินช่วงผ่อนผัน (sweep) — หลังจดเวลาให้ทุกไฟล์ใหม่ก่อน (mark)
 *
 * ⚠️ ตรวจซ้ำในทรานแซกชันที่ลบว่ายังไม่มีใครใช้ — ข้อมูลอาจเปลี่ยนระหว่าง mark กับ sweep
 * ⚠️ ลบแถวก่อน แล้วค่อยลบไฟล์หลัง commit: ถ้าลบไฟล์ล้ม เหลือแค่ไฟล์กำพร้าบนดิสก์
 *    (กินที่แต่ไม่ทำให้ใครเห็นรูปแตก) · กลับกันจะได้แถวที่ชี้ไปไฟล์ที่ไม่มีแล้ว
 */
export async function purgeUnusedMedia(actor: AdminLogActor): Promise<MediaPurgeResult> {
  const prisma = getPrisma();

  await refreshUnusedMarks();

  const threshold = graceThreshold();
  const candidates = await prisma.mediaAsset.findMany({
    where: { unusedSince: { lte: threshold } },
    orderBy: { unusedSince: 'asc' },
    take: PURGE_BATCH,
    select: { id: true, url: true, storageKey: true, bytes: true, purpose: true },
  });

  const removed = await prisma.$transaction(async (tx) => {
    const stillUsed = await usedAmong(
      tx,
      candidates.map((row) => row.url),
    );
    const removable = candidates.filter((row) => !stillUsed.has(row.url));

    if (removable.length === 0) return [];

    await tx.mediaAsset.deleteMany({
      where: { id: { in: removable.map((row) => row.id) }, unusedSince: { lte: threshold } },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'media.purge',
      targetType: 'MediaAsset',
      targetId: null,
      before: {
        files: removable.length,
        bytes: removable.reduce((sum, row) => sum + row.bytes, 0),
        urls: removable.map((row) => row.url),
      },
      // คีย์ชุดเดียวกับ before (กฎ STEP 27) — หน้าประวัติจึงอ่านได้ว่า "จาก N ไฟล์ เหลือ 0"
      after: { files: 0, bytes: 0, urls: [] },
    });

    return removable;
  });

  for (const row of removed) {
    await removeMediaFile(row.storageKey).catch((error: unknown) => {
      logger.warn({ err: error, storageKey: row.storageKey }, 'ลบไฟล์รูปออกจากดิสก์ไม่สำเร็จ');
    });
  }

  const waiting = await prisma.mediaAsset.count({
    where: { unusedSince: { gt: threshold } },
  });

  return {
    deleted: removed.length,
    freedBytes: removed.reduce((sum, row) => sum + row.bytes, 0),
    waiting,
  };
}
