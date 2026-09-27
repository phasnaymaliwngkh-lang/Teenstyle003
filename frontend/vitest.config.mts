import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ทุก project ใช้ตัวแปลงและ alias ชุดเดียวกัน
 *
 * tsconfig ของ Next ตั้ง jsx: "preserve" (ให้ Next แปลงเอง) — vite จึงแปลง .tsx ไม่ได้
 * ต้องบอกให้ใช้ JSX runtime อัตโนมัติที่นี่ ไม่งั้น import คอมโพเนนต์เข้ามาเทสต์ไม่ได้เลย
 */
const shared = {
  oxc: { jsx: { runtime: 'automatic' as const } },
  resolve: {
    alias: { '@': path.resolve(here, 'src') },
  },
};

/**
 * เทสต์ของ frontend — แยกเป็น 2 project เพราะสภาพแวดล้อมต่างกันจริง (STEP 37)
 *
 * `pure` (environment: node)
 *   - `src/**\/*.test.ts`   ฟังก์ชันล้วนใน `src/lib` (safe-redirect ของ STEP 28 · seo ของ STEP 33)
 *   - `tests/**\/*.test.ts` กฎระดับโปรเจกต์ที่อ่านซอร์สมาตรวจ (responsive ของ STEP 31)
 *
 * `dom` (environment: jsdom) — เพิ่มใน STEP 37
 *   - `src/**\/*.test.tsx`  คอมโพเนนต์จริงที่เรนเดอร์แล้วกดด้วย user-event
 *
 * ทำไมต้องแยก project ไม่ใช่ตั้ง jsdom ให้ทั้งหมด: setup ของฝั่ง DOM mock `next/navigation`
 * `next/link` `next/image` ไว้ ซึ่งไม่ควรมีผลกับเทสต์ฟังก์ชันล้วน · และ environment: node
 * เร็วกว่ามากสำหรับไฟล์ที่ไม่ต้องมี DOM (เทสต์ responsive อ่านไฟล์ซอร์สหลายร้อยไฟล์)
 */
export default defineConfig({
  test: {
    /**
     * วัด coverage ด้วย `npm run test:coverage` (เพิ่มใน STEP 37)
     * ใช้หาคอมโพเนนต์ที่ยังไม่มีเทสต์แตะ ไม่ใช่เป้าที่ต้องไล่ให้ถึง 100%
     */
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
    projects: [
      {
        ...shared,
        test: {
          name: 'pure',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          restoreMocks: true,
        },
      },
      {
        ...shared,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['tests/setup-dom.tsx'],
          restoreMocks: true,
        },
      },
    ],
  },
});
