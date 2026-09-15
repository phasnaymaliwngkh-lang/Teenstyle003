import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

/**
 * โหลด .env แบบชัดเจน (ลำดับความสำคัญ: process.env > backend/.env > <repo root>/.env)
 * dotenv จะไม่ override ค่าที่มีอยู่แล้ว ทำให้ค่าที่ตั้งจาก shell / docker ชนะเสมอ
 *
 * โครงสร้าง path เท่ากันทั้ง dev (src/config) และ production (dist/config)
 */
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '..', '.env'), quiet: true });
loadEnv({ path: path.resolve(here, '..', '..', '..', '.env'), quiet: true });

/**
 * ค่าที่ว่างเปล่าใน `.env` ให้ถือว่า "ไม่ได้ตั้งค่า" ไม่ใช่ "ตั้งค่าเป็นสตริงว่าง"
 *
 * ไฟล์ `.env` มักมีบรรทัด placeholder เช่น `STRIPE_SECRET_KEY=` ค้างไว้
 * ถ้าไม่แปลงเป็น undefined จะ fail validation ทั้งที่ผู้ใช้เพียงยังไม่ได้กรอก
 * (เคยเจอปัญหาคล้ายกันตอน STEP 3: `AUTH_SECRET=` ว่างใน .env.local ทับค่าจริง)
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  BACKEND_URL: z.string().min(1).default('http://localhost:4000'),
  FRONTEND_URL: z.string().min(1).default('http://localhost:3000'),

  /** รายการ origin ที่อนุญาต คั่นด้วย comma */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  /** STEP 1 ยังไม่บังคับ — จะกลายเป็นค่าที่ต้องมีตั้งแต่ STEP 2 (Database) */
  DATABASE_URL: optionalSecret,
  /** STEP 34 (cache) / STEP 52 (BullMQ) */
  REDIS_URL: optionalSecret,

  /**
   * Stripe (STEP 11) — ไม่บังคับ
   * ถ้าไม่ได้ตั้งค่า ระบบจะ **ไม่เปิด** ช่องทางชำระเงินด้วยบัตร/PromptPay
   * และบอกผู้ใช้ตรง ๆ ว่ายังตั้งค่าไม่ครบ (ห้ามทำหน้าจ่ายเงินปลอมแทน)
   */
  STRIPE_SECRET_KEY: optionalSecret,
  /** secret ของ webhook endpoint (`whsec_...`) — ใช้ตรวจลายเซ็นทุก event */
  STRIPE_WEBHOOK_SECRET: optionalSecret,

  /** ระยะเวลาที่จองสินค้าไว้ให้ก่อนคำสั่งซื้อหมดอายุ (นาที) */
  PAYMENT_WINDOW_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1440),

  /**
   * อีเมล (STEP 16 ใช้กับการแจ้งเตือนสต็อก · ระบบส่งอีเมลเต็มรูปแบบคือ STEP 50)
   * ถ้าตั้งค่าไม่ครบ ช่องทางอีเมลจะถูก **ปิด** และบอกเหตุผลตรง ๆ
   * (ห้ามสร้างแถวแจ้งเตือนช่องทางอีเมลแล้วบอกว่าส่งแล้วทั้งที่ส่งไม่ได้)
   */
  SMTP_HOST: optionalSecret,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: optionalSecret,
  SMTP_PASSWORD: optionalSecret,
  MAIL_FROM: optionalSecret,

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof EnvSchema>;

function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // fail fast: บอกให้ชัดว่า env ตัวไหนผิด แล้วหยุดทันที (ห้าม start ด้วย config ที่ไม่ถูกต้อง)
    console.error('❌ Environment variables ไม่ถูกต้อง — backend หยุดทำงาน\n');
    for (const issue of parsed.error.issues) {
      console.error(`   • ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    console.error('\n   คัดลอก .env.example เป็น .env แล้วกรอกค่าให้ครบก่อนรันอีกครั้ง');
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadConfig();

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
