import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

/**
 * โหลด .env ก่อนรันเทสต์ทุกไฟล์
 * (vitest ไม่โหลด .env ให้เอง และเทสต์ integration ต้องใช้ DATABASE_URL จริง)
 */
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '.env'), quiet: true });
loadEnv({ path: path.resolve(here, '..', '..', '.env'), quiet: true });

/**
 * secret ปลอมสำหรับทดสอบ webhook ของ Stripe (STEP 11)
 *
 * ลายเซ็นของ Stripe คือ HMAC-SHA256 ของ `timestamp.body` ด้วย secret นี้
 * จึงเซ็น payload ทดสอบเองได้ **โดยไม่ต้องมีบัญชี Stripe จริง**
 * → ทดสอบเส้นทางเงินที่สำคัญที่สุดได้จริง (ตัดสต็อกครั้งเดียว, กัน event ซ้ำ, ลายเซ็นผิด)
 *
 * ตั้งเฉพาะตอนเทสต์ และไม่ตั้ง STRIPE_SECRET_KEY จึงยังถือว่า "Stripe ยังไม่พร้อมใช้"
 * (เทสต์ตรวจด้วยว่าช่องทาง Stripe ถูกปิดอยู่จริง)
 */
// ใช้ `||` ไม่ใช่ `??=` เพราะ .env มีบรรทัด `STRIPE_WEBHOOK_SECRET=` ว่างไว้ (ค่าเป็น '' ไม่ใช่ undefined)
process.env['STRIPE_WEBHOOK_SECRET'] =
  process.env['STRIPE_WEBHOOK_SECRET'] || 'whsec_test_local_only_not_a_real_secret';

/**
 * ไฟล์รูปที่เทสต์อัปโหลด (STEP 47) — ลงโฟลเดอร์ชั่วคราวของระบบเสมอ **ทับค่าใน .env โดยเจตนา**
 * ไม่งั้นเทสต์จะเขียนไฟล์ลงโฟลเดอร์รูปจริงของ dev แล้วค้างอยู่ (เทสต์แต่ละไฟล์ลบไฟล์ของตัวเองใน afterAll)
 */
process.env['UPLOAD_DIR'] = path.join(os.tmpdir(), 'teenstyle-test-uploads');
