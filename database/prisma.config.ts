import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 ไม่โหลด .env ให้อัตโนมัติ และ `url` ย้ายออกจาก schema.prisma มาอยู่ที่ไฟล์นี้
 * เราโหลด .env จาก root ของ repo (../.env) แล้วเปิดช่องให้ database/.env override ได้
 */
const here = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(here, '.env'), quiet: true });
loadEnv({ path: path.resolve(here, '..', '.env'), quiet: true });

/**
 * ใช้ process.env ตรง ๆ แทน helper `env()` ของ Prisma
 * เพราะ env() จะ throw ทันทีถ้าไม่มีค่า ทำให้ `prisma generate` (ที่ไม่ต้องต่อ DB) พังไปด้วย
 * ส่วนคำสั่งที่ต้องต่อ DB จริง (migrate / studio / db seed) Prisma จะแจ้ง error เองถ้า url ว่าง
 */
const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    // เก็บ migration ไว้ที่ database/migrations ตามโครงสร้างของโปรเจกต์
    path: 'migrations',
    seed: 'tsx seed/seed.ts',
  },
});
