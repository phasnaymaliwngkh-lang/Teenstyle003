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
