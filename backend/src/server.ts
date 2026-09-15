import type { Server } from 'node:http';

import { disconnectDatabase } from '@teenstyle/database';

import { createApp } from './app.ts';
import { API_VERSION, env } from './config/index.ts';
import { logger } from './utils/logger.ts';

const app = createApp();

const server: Server = app.listen(env.BACKEND_PORT, () => {
  logger.info(
    {
      port: env.BACKEND_PORT,
      environment: env.NODE_ENV,
      version: API_VERSION,
      corsOrigin: env.CORS_ORIGIN,
    },
    `🚀 TEENSTYLE AI API พร้อมใช้งานที่ ${env.BACKEND_URL}`,
  );

  if (!env.DATABASE_URL) {
    logger.warn(
      'DATABASE_URL ยังไม่ได้ตั้งค่า — endpoint ที่ใช้ database จะยังทำงานไม่ได้ (STEP 2)',
    );
  }
});

/** ปิด server ให้เรียบร้อย: หยุดรับ connection ใหม่ → ปิด connection ที่ค้าง → ตัด database */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'กำลังปิด server...');

  const forceExit = setTimeout(() => {
    logger.error('ปิด server ไม่ทันเวลา — บังคับปิด');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await disconnectDatabase();
    logger.info('ปิด server เรียบร้อย');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'เกิดข้อผิดพลาดระหว่างปิด server');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception — ปิด process');
  process.exit(1);
});
