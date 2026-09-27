import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    // เทสต์ integration แตะฐานข้อมูลจริง จึงห้ามรันไฟล์พร้อมกันเพื่อไม่ให้ข้อมูลชนกัน
    fileParallelism: false,
    /**
     * วัด coverage ด้วย `npm run test:coverage` (เพิ่มใน STEP 37)
     *
     * ⚠️ ตัวเลขนี้ใช้ **หาที่ที่ยังไม่มีเทสต์แตะเลย** ไม่ใช่เป้าที่ต้องไล่ให้ถึง 100%
     *    เทสต์ที่เขียนเพื่อดันเลข coverage คือเทสต์ที่ผ่านแบบหลอก ๆ
     *    สิ่งที่พบจากการวัดครั้งแรกอยู่ใน docs/11-testing.md
     */
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
  resolve: {
    alias: {
      /**
       * ชี้ @teenstyle/database ไปที่ TypeScript source ตรง ๆ
       * เพราะ exports.default ของ package ชี้ไป dist/ ที่ใช้เฉพาะตอน production
       * (vitest แปลง TS ได้เอง จึงไม่ต้อง build database ก่อนรันเทสต์)
       */
      '@teenstyle/database': path.resolve(here, '..', 'database', 'src', 'index.ts'),
    },
  },
});
