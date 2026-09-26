import type { Server } from 'node:http';

import { disconnectDatabase } from '@teenstyle/database';

import { createApp } from './app.ts';
import { API_VERSION, env, listenPort } from './config/index.ts';
import { logger } from './utils/logger.ts';

const app = createApp();

/**
 * listen ที่ `listenPort` (= `PORT` ของโฮสต์ ถ้ามี) และไม่ระบุ host
 * เพื่อให้ Node bind ทุก interface — โฮสต์อย่าง Railway/Render เข้าถึงได้
 * (ถ้า bind เฉพาะ 127.0.0.1 จะเข้าจากนอก container ไม่ได้)
 */
const server: Server = app.listen(listenPort, () => {
  logger.info(
    {
      port: listenPort,
      portSource: env.PORT !== undefined ? 'PORT (จากโฮสต์)' : 'BACKEND_PORT',
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

  /**
   * เตือนตอน production ว่า rate limit ยังนับแยกต่อ process (STEP 34)
   *
   * เตือนตรงนี้เพราะเป็นจุดเดียวที่คนดูแลระบบเห็นแน่ ๆ ตอน deploy
   * ถ้าไม่เตือน ระบบจะดู "มี rate limit แล้ว" ทั้งที่ค่าจริงถูกคูณด้วยจำนวน instance
   * (รายละเอียดและทางแก้อยู่ใน middlewares/rate-limit.ts)
   */
  if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
    logger.warn(
      { rateLimitMax: env.RATE_LIMIT_MAX },
      'ยังไม่มี REDIS_URL — rate limit นับแยกในแต่ละ process ' +
        'ถ้ารันหลาย instance limit จริงจะเท่ากับ RATE_LIMIT_MAX × จำนวน instance ' +
        '(ตั้ง limit ที่ proxy/ingress หรือใส่ Redis ก่อน scale)',
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
