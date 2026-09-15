import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

const app = createApp();

describe('GET /health', () => {
  it('ตอบกลับสถานะของระบบตาม shape มาตรฐาน', async () => {
    const response = await request(app).get('/health');

    // ยังไม่มี Postgres ใน STEP 1 → 200 (ok) หรือ 503 (degraded) ถือว่าถูกต้องทั้งคู่
    expect([200, 503]).toContain(response.status);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe('teenstyle-ai-api');
    expect(response.body.data.services).toHaveProperty('database');
    expect(response.body.data.services).toHaveProperty('redis');
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
  });

  it('ส่ง X-Request-Id กลับมาทุกครั้ง', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('GET /api', () => {
  it('คืนรายการ endpoint ของ API', async () => {
    const response = await request(app).get('/api');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.endpoints)).toBe(true);
    expect(response.body.data.endpoints.length).toBeGreaterThan(0);
  });
});

describe('Error handling', () => {
  it('คืน 404 ตาม shape { success, message, errorCode }', async () => {
    const response = await request(app).get('/api/this-route-does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: 'NOT_FOUND',
    });
    expect(typeof response.body.message).toBe('string');
  });

  it('คืน 400 เมื่อ JSON body พัง', async () => {
    const response = await request(app)
      .post('/api')
      .set('Content-Type', 'application/json')
      .send('{ "broken": ');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe('BAD_REQUEST');
  });
});
