import { randomUUID } from 'node:crypto';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env, isDevelopment, isTest } from './config/index.ts';
import { errorHandler, globalRateLimiter, notFound, requestId } from './middlewares/index.ts';
import { rootRouter } from './routes/index.ts';
import { logger } from './utils/logger.ts';

/**
 * ประกอบ Express application
 * แยกจาก server.ts เพื่อให้เทสต์ import app ได้โดยไม่ต้องเปิด port จริง
 */
export function createApp(): Express {
  const app = express();

  // อยู่หลัง reverse proxy (Railway / Render / Nginx) — ให้ req.ip และ rate limit ถูกต้อง
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      hsts: isDevelopment ? false : undefined,
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true, // ต้องเปิดเพราะ session ใช้ cookie (STEP 3)
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  // ─── Request pipeline ─────────────────────────────────────────────────────
  app.use(requestId);
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // ใช้ id เดียวกับที่ requestId middleware ตั้งไว้ เพื่อให้ log กับ header ตรงกัน
        genReqId: (req) => (req as { requestId?: string }).requestId ?? randomUUID(),
      }),
    );
  }
  app.use(compression());

  /**
   * ⚠️ Stripe webhook ต้องได้ **raw body** เพื่อตรวจลายเซ็น (STEP 11)
   *    จึง mount ก่อน express.json() และจำกัดเฉพาะเส้นทางนี้เส้นทางเดียว
   *    ถ้าให้ express.json แปลงก่อน ลายเซ็นจะตรวจไม่ผ่านทุกครั้ง
   */
  app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  // ─── Routes ───────────────────────────────────────────────────────────────
  app.use(rootRouter);

  // ─── 404 + Error handler (ต้องอยู่ท้ายสุดเสมอ) ────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
