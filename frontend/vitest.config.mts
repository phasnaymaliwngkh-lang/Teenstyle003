import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * เทสต์ของ frontend (เพิ่มใน STEP 28)
 *
 * เดิม frontend ไม่มีตัวรันเทสต์เลย ซึ่งยอมรับได้ตอนที่โค้ดเป็น UI ล้วน
 * แต่ STEP 28 เพิ่ม `lib/safe-redirect.ts` ที่เป็น **ตรรกะความปลอดภัย**
 * — ของแบบนี้พังเงียบ ๆ ได้ และพังแล้วกลายเป็นช่องฟิชชิง จึงต้องมีเทสต์ล็อกไว้
 *
 * ขอบเขตตอนนี้ (ยังไม่ต้องมี DOM ทั้งคู่ — ดู include ข้างล่าง)
 *   - ไฟล์ .test.ts ใน `src`   ฟังก์ชันล้วนใน `src/lib`
 *   - ไฟล์ .test.ts ใน `tests` กฎระดับโปรเจกต์ที่อ่านซอร์สมาตรวจ (เพิ่มใน STEP 31 — กฎ responsive)
 *
 * การเทสต์คอมโพเนนต์ (ต้องมี jsdom + testing-library) เป็นงานของ STEP 37
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    restoreMocks: true,
  },
  resolve: {
    alias: { '@': path.resolve(here, 'src') },
  },
});
