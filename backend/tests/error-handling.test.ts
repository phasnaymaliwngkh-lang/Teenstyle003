import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma, disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { createApp } from '../src/app.ts';
import { normalizeError } from '../src/middlewares/error-handler.ts';
import { ApiError, ERROR_CODES } from '../src/utils/api-error.ts';

/**
 * Error handling (STEP 30)
 *
 * ทุกเคสในไฟล์นี้คือคำถามเดียวกัน: **ผู้ใช้ได้คำตอบที่ถูกต้องและทำอะไรต่อได้ไหม**
 * error ที่ตอบ 500 "เกิดข้อผิดพลาดภายในระบบ" ทั้งที่เป็นความผิดของคำขอ มีราคาสองต่อ —
 * ผู้ใช้ไม่รู้ว่าต้องแก้อะไร และเราไปไล่หาบั๊กในที่ที่ไม่มีบั๊ก
 * (ตอนเริ่ม STEP 30 มี 4 เส้นทางที่ตอบ 500 แบบนี้อยู่จริง — ดูหัวข้อ HTTP ด้านล่าง)
 *
 * แบ่งเป็นสามส่วน
 *   1. `normalizeError()` แบบ unit — ยิง error สังเคราะห์เข้าไปตรง ๆ
 *      เพราะ error บางชนิด (P2002 ของ Prisma) สร้างผ่าน HTTP จริงได้ยาก เนื่องจาก service ดักไว้ก่อนแล้ว
 *   2. ผ่าน HTTP จริง — พิสูจน์ว่าเส้นทางที่เคยตอบ 500 ตอบสถานะที่ถูกแล้ว
 *   3. ตารางรหัสข้อผิดพลาดในเอกสารตรงกับโค้ด
 */
const app = createApp();
const prisma = getPrisma();

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(here, '..', '..', 'docs', '09-api-reference.md');

const suffix = randomUUID().slice(0, 8);
const createdUserIds: string[] = [];
let admin = { id: '', token: '' };

async function createTestUser(role: string, tag: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role as 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: {
      email: `test-err-${tag}-${suffix}@teenstyle.test`,
      name: `ทดสอบ ${tag}`,
      roleId: roleRow.id,
      status: 'ACTIVE',
    },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

beforeAll(async () => {
  admin = await createTestUser('SUPER_ADMIN', 'admin');
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await disconnectDatabase();
});

const auth = () => ({ Authorization: `Bearer ${admin.token}` });

/* ───────────────────── 1. normalizeError() ───────────────────── */

describe('normalizeError() — error ที่เราตั้งใจโยน', () => {
  it('ApiError ผ่านไปตรง ๆ ทั้งสถานะ ข้อความ และ details', () => {
    const error = ApiError.conflict('สต็อกไม่พอ', [{ variantId: 'x', available: 2 }]);

    expect(normalizeError(error)).toEqual({
      statusCode: 409,
      message: 'สต็อกไม่พอ',
      errorCode: 'CONFLICT',
      details: [{ variantId: 'x', available: 2 }],
    });
  });

  it('ApiError ที่ไม่มี details ต้องไม่มีคีย์ details ติดไปด้วย', () => {
    const normalized = normalizeError(ApiError.notFound('ไม่พบสินค้านี้'));

    expect(normalized).not.toHaveProperty('details');
  });

  it('ZodError → 422 พร้อมบอกว่า field ไหนผิดเป็นรายช่อง', () => {
    let caught: unknown;
    try {
      z.object({ quantity: z.number({ message: 'quantity ต้องเป็นตัวเลข' }) }).parse({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ZodError);
    const normalized = normalizeError(caught);

    expect(normalized.statusCode).toBe(422);
    expect(normalized.errorCode).toBe('VALIDATION_ERROR');
    expect(normalized.details).toEqual([{ field: 'quantity', message: 'quantity ต้องเป็นตัวเลข' }]);
  });
});

describe('normalizeError() — error ของ body-parser', () => {
  it('body ใหญ่เกินกำหนด → 413 ไม่ใช่ 500', () => {
    const normalized = normalizeError({ type: 'entity.too.large', status: 413 });

    expect(normalized.statusCode).toBe(413);
    expect(normalized.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(normalized.message).toContain('1MB');
  });

  it('charset ที่อ่านไม่ได้ → 415', () => {
    expect(normalizeError({ type: 'charset.unsupported' }).statusCode).toBe(415);
    expect(normalizeError({ type: 'encoding.unsupported' }).errorCode).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('JSON พัง → 400 และไม่บอกว่าเป็น SyntaxError', () => {
    const normalized = normalizeError({ type: 'entity.parse.failed' });

    expect(normalized.statusCode).toBe(400);
    expect(normalized.message).not.toContain('SyntaxError');
  });
});

describe('normalizeError() — error ของ multer', () => {
  it('ไฟล์ใหญ่เกิน → 413 พร้อมบอกขนาดสูงสุด', () => {
    const normalized = normalizeError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' });

    expect(normalized.statusCode).toBe(413);
    expect(normalized.message).toContain('5MB');
  });

  it('ส่งไฟล์เกิน 1 ไฟล์ หรือผิดชื่อ field → 400 พร้อมบอกชื่อ field ที่ถูก', () => {
    const normalized = normalizeError({ name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' });

    expect(normalized.statusCode).toBe(400);
    expect(normalized.message).toContain('file');
  });
});

describe('normalizeError() — ตาข่ายรับ error ของ Prisma', () => {
  function known(code: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('ข้อความภายในของ Prisma', {
      code,
      clientVersion: 'test',
    });
  }

  it('unique ซ้ำ (P2002) → 409', () => {
    const normalized = normalizeError(known('P2002'));

    expect(normalized.statusCode).toBe(409);
    expect(normalized.errorCode).toBe('CONFLICT');
  });

  it('ไม่พบแถวที่จะแก้ (P2025) → 404', () => {
    expect(normalizeError(known('P2025')).statusCode).toBe(404);
  });

  it('ชน foreign key (P2003 / P2014) → 409', () => {
    expect(normalizeError(known('P2003')).statusCode).toBe(409);
    expect(normalizeError(known('P2014')).statusCode).toBe(409);
  });

  it('ค่ายาวเกินคอลัมน์ (P2000) → 400', () => {
    expect(normalizeError(known('P2000')).statusCode).toBe(400);
  });

  it('ทรานแซกชันชนกัน (P2034) → 409 และบอกให้ลองอีกครั้ง', () => {
    const normalized = normalizeError(known('P2034'));

    expect(normalized.statusCode).toBe(409);
    expect(normalized.message).toContain('ลองอีกครั้ง');
  });

  it('รหัสที่ไม่ได้แม็ปไว้ → 500 และไม่หลุดข้อความภายในของ Prisma', () => {
    const normalized = normalizeError(known('P2999'));

    expect(normalized.statusCode).toBe(500);
    expect(normalized.message).not.toContain('Prisma');
  });

  it('ต่อฐานข้อมูลไม่ได้ → 503 ไม่ใช่ 500 (503 = ลองใหม่ได้ · 500 = โค้ดเราพัง)', () => {
    const error = new Prisma.PrismaClientInitializationError(
      "Can't reach database server",
      'test',
      'P1001',
    );
    const normalized = normalizeError(error);

    expect(normalized.statusCode).toBe(503);
    expect(normalized.errorCode).toBe('SERVICE_UNAVAILABLE');
    expect(normalized.message).not.toContain('database server');
  });
});

describe('normalizeError() — error ทั่วไป', () => {
  it('error แบบ http-errors ที่ expose ไว้ → ใช้สถานะของมัน แต่ไม่ใช้ข้อความอังกฤษของไลบรารี', () => {
    const normalized = normalizeError({
      name: 'Error',
      message: 'incorrect header check',
      status: 400,
      expose: true,
    });

    expect(normalized.statusCode).toBe(400);
    expect(normalized.errorCode).toBe('BAD_REQUEST');
    expect(normalized.message).not.toContain('header check');
  });

  it('URL ที่ percent-encode มาไม่ถูกต้อง → 400 (Express ตั้ง status ให้แต่ไม่ตั้ง expose)', () => {
    const error = new URIError("Failed to decode param '%E4%C1%E8'");
    const normalized = normalizeError(error);

    expect(normalized.statusCode).toBe(400);
    expect(normalized.errorCode).toBe('BAD_REQUEST');
    expect(normalized.message).toContain('UTF-8');
  });

  it('error ที่ไม่ได้ expose ไว้ → 500 แม้จะมี status ติดมา', () => {
    const normalized = normalizeError({ status: 400, expose: false, message: 'ภายใน' });

    expect(normalized.statusCode).toBe(500);
  });

  it('Error ธรรมดา → 500 และ **ไม่หลุดข้อความจริง** ออกไปให้ client', () => {
    const normalized = normalizeError(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    expect(normalized.statusCode).toBe(500);
    expect(normalized.errorCode).toBe('INTERNAL_ERROR');
    expect(normalized.message).toBe('เกิดข้อผิดพลาดภายในระบบ');
    expect(JSON.stringify(normalized)).not.toContain('10.0.0.5');
  });

  it('สิ่งที่โยนมาโดยไม่ใช่ Error เลย (สตริง / null) ก็ยังได้ shape เดิม', () => {
    for (const thrown of ['พัง', null, undefined, 42, []]) {
      const normalized = normalizeError(thrown);

      expect(normalized.statusCode).toBe(500);
      expect(normalized.errorCode).toBe('INTERNAL_ERROR');
    }
  });
});

/* ───────────────────── 2. ผ่าน HTTP จริง ───────────────────── */

describe('เส้นทางที่เคยตอบ 500 ทั้งที่เป็นความผิดของคำขอ (แก้ใน STEP 30)', () => {
  it('JSON body ใหญ่เกิน 1MB → 413 ไม่ใช่ 500', async () => {
    const response = await request(app)
      .post('/api/products/availability')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ items: 'x'.repeat(1_200_000) }));

    expect(response.status).toBe(413);
    expect(response.body.errorCode).toBe('PAYLOAD_TOO_LARGE');
  });

  it('อัปโหลดไฟล์ผิดชนิด → 400 พร้อมบอกชนิดที่รับได้ ไม่ใช่ 500 ที่ไม่บอกอะไร', async () => {
    const response = await request(app)
      .post('/api/admin/import/products')
      .set(auth())
      .attach('file', Buffer.from('<?php echo 1; ?>'), 'shell.php');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('.csv');
    expect(response.body.message).toContain('.xlsx');
  });

  it('charset ที่อ่านไม่ได้ → 415 ไม่ใช่ 500', async () => {
    const response = await request(app)
      .post('/api/products/availability')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{"a":1}');

    expect(response.status).toBe(415);
    expect(response.body.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('path ที่มีไบต์ซึ่งไม่ใช่ UTF-8 → 400 ไม่ใช่ 500', async () => {
    /**
     * `%E4%C1%E8` คือ "ไม่" ที่เข้ารหัสแบบ TIS-620 ไม่ใช่ UTF-8 — เกิดจากลิงก์เก่าและบ็อตได้เอง
     * Express โยน URIError ตอนแกะ `:slug` ซึ่งเดิมกลายเป็น 500 พร้อม log ระดับ error
     */
    const response = await request(app).get('/api/products/%E4%C1%E8');

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('BAD_REQUEST');
    expect(response.body.message).toContain('UTF-8');
  });

  it('body ที่บอกว่าบีบอัดมาแต่บีบอัดไม่จริง → 400 ไม่ใช่ 500', async () => {
    // สำคัญเพราะ 500 ทำให้การเฝ้าระวังเตือนว่า "ระบบเราพัง" ทั้งที่เป็นไคลเอนต์ส่งมาผิด
    const response = await request(app)
      .post('/api/products/availability')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('{}');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});

describe('อัปโหลดไฟล์ที่ใหญ่เกินกำหนด', () => {
  it('เกิน 5MB → 413 พร้อมบอกขนาดสูงสุด', async () => {
    const response = await request(app)
      .post('/api/admin/import/products')
      .set(auth())
      .attach('file', Buffer.alloc(6 * 1024 * 1024, 0x61), 'big.csv');

    expect(response.status).toBe(413);
    expect(response.body.message).toContain('5MB');
  });
});

describe('ทุก error ใช้ shape เดียวกัน ไม่ว่าจะเกิดจากชั้นไหน', () => {
  const cases: { label: string; run: () => Promise<{ status: number; body: ApiErrorShape }> }[] = [
    {
      label: 'เส้นทางที่ไม่มีจริง',
      run: async () => {
        const res = await request(app).get('/api/no-such-route');
        return { status: res.status, body: res.body as ApiErrorShape };
      },
    },
    {
      label: 'เมธอดที่เส้นทางนั้นไม่รองรับ',
      run: async () => {
        const res = await request(app).delete('/api/products/search');
        return { status: res.status, body: res.body as ApiErrorShape };
      },
    },
    {
      label: 'ไม่ได้ล็อกอิน',
      run: async () => {
        const res = await request(app).get('/api/orders');
        return { status: res.status, body: res.body as ApiErrorShape };
      },
    },
    {
      label: 'ค่าใน query ผิดรูปแบบ',
      run: async () => {
        const res = await request(app).get('/api/admin/logs?from=ไม่ใช่วันที่').set(auth());
        return { status: res.status, body: res.body as ApiErrorShape };
      },
    },
    {
      label: 'id ที่ไม่ใช่ UUID',
      run: async () => {
        const res = await request(app).get('/api/admin/products/not-a-uuid').set(auth());
        return { status: res.status, body: res.body as ApiErrorShape };
      },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} → { success: false, message, errorCode }`, async () => {
      const { status, body } = await testCase.run();

      expect(status).toBeGreaterThanOrEqual(400);
      expect(body.success).toBe(false);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
      expect(Object.values(ERROR_CODES)).toContain(body.errorCode);
      // ไม่มี stack trace หลุดออกไปทาง response ไม่ว่ากรณีใด
      expect(JSON.stringify(body)).not.toContain('at ');
    });
  }
});

interface ApiErrorShape {
  success: boolean;
  message: string;
  errorCode: string;
}

/* ───────────────────── 3. เอกสารตรงกับโค้ด ───────────────────── */

describe('ตารางรหัสข้อผิดพลาดใน docs/09-api-reference.md', () => {
  const markdown = readFileSync(DOC_PATH, 'utf8');

  /** อ่านแถวรูปแบบ `| 409 | \`CONFLICT\` | ... |` */
  const documented = new Map<number, string>();
  for (const line of markdown.split('\n')) {
    const match = /^\|\s*(\d{3})\s*\|\s*`([A-Z_]+)`\s*\|/.exec(line);
    if (match) documented.set(Number(match[1]), match[2] as string);
  }

  it('อ่านตารางได้ครบทุกสถานะที่ระบบใช้จริง', () => {
    expect(documented.size).toBeGreaterThanOrEqual(9);
  });

  it('ทุกสถานะที่ ApiError สร้างได้ ถูกบันทึกไว้ในเอกสารด้วยรหัสเดียวกัน', () => {
    const produced: [number, string][] = [
      [400, ApiError.badRequest().errorCode],
      [401, ApiError.unauthorized().errorCode],
      [403, ApiError.forbidden().errorCode],
      [404, ApiError.notFound().errorCode],
      [409, ApiError.conflict().errorCode],
      [413, ApiError.payloadTooLarge().errorCode],
      [415, ApiError.unsupportedMediaType().errorCode],
      [422, ApiError.validation().errorCode],
      [429, ApiError.tooManyRequests().errorCode],
      [500, ApiError.internal().errorCode],
      [503, ApiError.serviceUnavailable().errorCode],
    ];

    const mismatches = produced
      .filter(([status, code]) => documented.get(status) !== code)
      .map(
        ([status, code]) => `${status} ควรเป็น ${code} แต่เอกสารเขียน ${documented.get(status)}`,
      );

    expect(mismatches).toEqual([]);
  });

  it('ไม่มีรหัสใน ERROR_CODES ที่ไม่ได้อธิบายไว้ในเอกสาร', () => {
    const inDoc = new Set(documented.values());
    const missing = Object.values(ERROR_CODES).filter((code) => !inDoc.has(code));

    expect(missing).toEqual([]);
  });
});
