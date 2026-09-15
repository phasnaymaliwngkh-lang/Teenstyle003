import { pino } from 'pino';

import { env, isDevelopment, isTest } from '../config/index.ts';

/**
 * Logger กลางของ backend (STEP 51 — Monitoring / Error logging)
 *
 * - dev  : pino-pretty อ่านง่ายใน terminal
 * - prod : JSON บรรทัดเดียว ส่งเข้า log aggregator ได้เลย
 * - redact ข้อมูลอ่อนไหวไม่ให้หลุดเข้า log (STEP 28 / STEP 53)
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.cardNumber',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
    ],
    censor: '[redacted]',
  },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
