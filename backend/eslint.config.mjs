import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      /* บังคับให้ตัวแปรที่ไม่ใช้ต้องขึ้นต้นด้วย _ เพื่อให้เห็นเจตนาชัด */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      /* ห้ามใช้ any โดยไม่ตั้งใจ — ขัดกับ UNIVERSAL RULE #7 (TypeScript strict) */
      '@typescript-eslint/no-explicit-any': 'error',
      /* ห้าม console.log ใน backend — ต้องใช้ logger (STEP 51) ยกเว้น config/env.ts ที่ต้องแจ้งก่อน logger พร้อม */
      'no-console': ['error', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
);
