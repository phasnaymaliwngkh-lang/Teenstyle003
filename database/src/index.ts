import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.ts';

export * from '../generated/prisma/client.ts';

/**
 * กฎบาร์โค้ด GTIN (STEP 17) — อยู่ที่ workspace นี้เพราะ seed และ backend
 * ต้องใช้กฎชุดเดียวกัน (เหตุผลเต็มอยู่ใน src/gtin.ts)
 */
export * from './gtin.ts';

/**
 * PrismaClient singleton
 *
 * Prisma 7 ต้องส่ง driver adapter เข้า constructor (ไม่มี `url` ใน schema แล้ว)
 * เราเก็บ instance ไว้บน globalThis เพื่อไม่ให้ hot-reload ของ tsx/next สร้าง connection pool ซ้ำ
 */
declare global {
  // eslint-disable-next-line no-var
  var __teenstylePrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. คัดลอก .env.example เป็น .env แล้วกรอกค่า DATABASE_URL ก่อนใช้งาน database',
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env['NODE_ENV'] === 'development'
        ? [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * ใช้ getPrisma() แทนการ import instance ตรง ๆ เพื่อให้ client ถูกสร้างแบบ lazy
 * (STEP 1 ยังไม่มี Postgres จริง — import module นี้ต้องไม่ทำให้ process ล้ม)
 */
export function getPrisma(): PrismaClient {
  if (!globalThis.__teenstylePrisma) {
    globalThis.__teenstylePrisma = createPrismaClient();
  }

  return globalThis.__teenstylePrisma;
}

/** ตรวจว่าเชื่อมต่อ database ได้จริง — ใช้ใน endpoint /health (STEP 51) */
export async function checkDatabaseHealth(): Promise<{ ok: boolean; message?: string }> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'unknown database error',
    };
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (globalThis.__teenstylePrisma) {
    await globalThis.__teenstylePrisma.$disconnect();
    globalThis.__teenstylePrisma = undefined;
  }
}
