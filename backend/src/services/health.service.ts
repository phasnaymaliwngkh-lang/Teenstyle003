import { checkDatabaseHealth } from '@teenstyle/database';

import { API_VERSION, APP_NAME, env } from '../config/index.ts';

export type ServiceState = 'ok' | 'down' | 'not-configured';

export interface ServiceStatus {
  status: ServiceState;
  message?: string;
}

export interface HealthReport {
  name: string;
  status: 'ok' | 'degraded';
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
    redis: ServiceStatus;
  };
}

/**
 * รวมสถานะของ dependency ทั้งหมด (STEP 51 — Monitoring)
 *
 * STEP 1: database จะเป็น 'not-configured' ถ้ายังไม่ได้ตั้ง DATABASE_URL
 *         redis ยังไม่ถูกใช้จนถึง STEP 34/52
 */
export async function getHealthReport(): Promise<HealthReport> {
  const database = await getDatabaseStatus();
  const redis = getRedisStatus();

  const degraded = [database, redis].some((service) => service.status === 'down');

  return {
    name: APP_NAME,
    status: degraded ? 'degraded' : 'ok',
    version: API_VERSION,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      api: { status: 'ok' },
      database,
      redis,
    },
  };
}

async function getDatabaseStatus(): Promise<ServiceStatus> {
  if (!env.DATABASE_URL) {
    return {
      status: 'not-configured',
      message: 'ยังไม่ได้ตั้ง DATABASE_URL (ใช้งานจริงใน STEP 2)',
    };
  }

  const result = await checkDatabaseHealth();

  return result.ok
    ? { status: 'ok' }
    : { status: 'down', ...(result.message ? { message: result.message } : {}) };
}

function getRedisStatus(): ServiceStatus {
  if (!env.REDIS_URL) {
    return {
      status: 'not-configured',
      message: 'ยังไม่ได้ตั้ง REDIS_URL (ใช้งานจริงใน STEP 34/52)',
    };
  }

  // STEP 34/52: จะ ping Redis จริงเมื่อเริ่มใช้ cache และ BullMQ
  return { status: 'not-configured', message: 'ยังไม่ได้เชื่อมต่อ Redis ในขั้นนี้' };
}
