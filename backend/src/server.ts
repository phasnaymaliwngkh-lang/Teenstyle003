import type { Server } from 'node:http';

import { disconnectDatabase } from '@teenstyle/database';

import { createApp } from './app.ts';
import { API_VERSION, env, listenPort } from './config/index.ts';
import { RATE_LIMIT_STORE_IS_PER_PROCESS } from './middlewares/rate-limit.ts';
import { flushProductViews } from './services/view-counter.service.ts';
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
    /**
     * บอกทั้ง **พอร์ตที่ฟังจริง** และ URL ที่เผยแพร่ — ห้ามบอกแค่ `BACKEND_URL`
     * เพราะโฮสต์ที่ฉีด `PORT` มาให้จะทำให้สองค่านี้ไม่ตรงกัน แล้วบรรทัดนี้จะบอกพอร์ตผิด
     * ซึ่งเป็นบรรทัดแรกที่คนอ่านตอนไล่หาสาเหตุ health check ล้ม (กับดักที่ docs/06 เตือนไว้)
     */
    `🚀 TEENSTYLE AI API ฟังอยู่ที่พอร์ต ${listenPort} · เผยแพร่ที่ ${env.BACKEND_URL}`,
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
   *
   * ⚠️ เงื่อนไขต้องเป็น **สถานะจริงของ store** ไม่ใช่ `!env.REDIS_URL`
   *    เดิมเช็ค `REDIS_URL` ซึ่งตรวจผิดเรื่อง: ใส่ค่าลง env (แม้ชี้ไป Redis ที่ไม่มีอยู่จริง —
   *    ซึ่ง `.env` ของเครื่องพัฒนาเป็นแบบนั้นอยู่) คำเตือนก็เงียบ ทั้งที่ยังไม่มี adapter
   *    และพฤติกรรมยังนับแยกต่อ process เหมือนเดิมทุกอย่าง
   *    (รายละเอียดและทางแก้อยู่ใน middlewares/rate-limit.ts)
   */
  if (env.NODE_ENV === 'production' && RATE_LIMIT_STORE_IS_PER_PROCESS) {
    logger.warn(
      { rateLimitMax: env.RATE_LIMIT_MAX, redisUrlConfigured: Boolean(env.REDIS_URL) },
      'rate limit นับแยกในแต่ละ process เพราะยังไม่มี store ที่แชร์กัน ' +
        'ถ้ารันหลาย instance limit จริงจะเท่ากับ RATE_LIMIT_MAX × จำนวน instance ' +
        '(การตั้ง REDIS_URL อย่างเดียวยังไม่เปลี่ยนพฤติกรรมนี้ — ต้องใส่ store ให้ limiter ด้วย) ' +
        'ระหว่างนี้ให้ตั้ง limit ที่ proxy/ingress ก่อน scale',
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
    // ยอดเข้าชมที่ยังรวมไว้ในหน่วยความจำ — เขียนก่อนตัดฐานข้อมูล ไม่งั้นหายทุกครั้งที่ deploy (STEP 46)
    await flushProductViews();
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
