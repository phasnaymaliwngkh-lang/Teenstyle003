import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { buildApiMap, type ApiRoute, type ApiRouteAuth } from '../src/models/api-map.ts';

/**
 * API contract test (STEP 29)
 *
 * ไฟล์นี้ไม่ทดสอบว่า endpoint ทำงานถูกไหม (ไฟล์อื่นทำหน้าที่นั้น) แต่ล็อก **สัญญาของ API**
 * ที่พังแบบเงียบ ๆ ได้ทั้งหมด:
 *
 *   1. เอกสาร [docs/09-api-reference.md](../../docs/09-api-reference.md) ต้องตรงกับ router จริง
 *      ทุกแถว — เอกสารที่เพี้ยนอันตรายกว่าไม่มีเอกสาร เพราะคนอ่านจะเชื่อว่าเส้นทางนี้ไม่ต้องมีสิทธิ์
 *   2. ด่านของทุกเส้นทางเป็นไปตามกฎ ไม่ใช่เท่าที่คนเขียนจำได้ — เส้นทางใหม่ที่ลืมด่าน
 *      จะยังตอบ 200 ตามปกติจนกว่าจะมีคนใช้ช่องนั้น
 *   3. ไม่มีเส้นทางที่ Express เรียกไปไม่ถึงเพราะถูก `/:param` ที่มาก่อนจับไปแล้ว
 *      (กับดักที่เจอซ้ำ ๆ ในโปรเจกต์นี้ และไม่มี error ให้เห็นเลย)
 *
 * รายการ "ข้อยกเว้น" ทุกชุดในไฟล์นี้เขียนไว้ตรง ๆ พร้อมเหตุผล — เพิ่มชื่อเข้ารายการได้
 * แต่ต้องเห็นใน diff ไม่ใช่ผ่านไปเงียบ ๆ
 */
const app = createApp();
const { routes, unreachable } = buildApiMap(app);

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(here, '..', '..', 'docs', '09-api-reference.md');

const key = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

/**
 * เส้นทางที่ **ไม่บังคับล็อกอิน** ทั้งหมด
 *
 * ทุกบรรทัดที่นี่คือการตัดสินใจเปิดให้คนที่ไม่ได้ล็อกอินเรียกได้
 * ถ้ามี endpoint ใหม่โผล่มาโดยไม่มีในรายการนี้ = มีคนเปิดช่องโดยไม่ได้ตั้งใจ
 *
 * `public` = ไม่สนใจว่าใครเรียก · `optional` = guest ใช้ได้ แต่ถ้าล็อกอินอยู่จะตอบข้อมูลรายบุคคลเพิ่ม
 */
const GUEST_REACHABLE: Record<string, Extract<ApiRouteAuth, 'public' | 'optional'>> = {
  'GET /health': 'public',
  'GET /api': 'public',

  // แคตตาล็อก — ใครก็ดูสินค้าได้
  'GET /api/products': 'public',
  'GET /api/products/search': 'public',
  'GET /api/products/filters': 'public',
  'POST /api/products/availability': 'public',
  'GET /api/products/:slug': 'public',
  'GET /api/categories': 'public',
  'GET /api/looks': 'public',
  'GET /api/looks/search': 'public',
  'GET /api/looks/filters': 'public',
  'POST /api/looks/:slug/availability': 'public',
  'GET /api/looks/:slug': 'public',

  // รีวิวอ่านได้ทุกคน · คนที่ล็อกอินได้รีวิวตัวเองที่ยังรอตรวจกลับไปด้วย
  'GET /api/products/:slug/reviews': 'optional',

  // ช่องทางชำระเงินต้องรู้ได้ก่อนล็อกอิน · webhook มาจาก Stripe ไม่ใช่ผู้ใช้
  'GET /api/payments/methods': 'public',
  'POST /api/payments/webhook/stripe': 'public',

  // ตะกร้าของ guest อ้างอิงด้วย cookie `cart-token`
  'GET /api/cart': 'optional',
  'POST /api/cart/items': 'optional',
  'PATCH /api/cart/items/:itemId': 'optional',
  'PATCH /api/cart/items/:itemId/select': 'optional',
  'DELETE /api/cart/items/:itemId': 'optional',
  'POST /api/cart/looks/:slug': 'optional',
  'DELETE /api/cart': 'optional',

  // AI เปิดให้ guest ใช้ — เจ้าของบทสนทนาของ guest มาจาก cookie `ai-session-id`
  'GET /api/ai/stylist/history': 'optional',
  'POST /api/ai/stylist/chat': 'optional',
  'POST /api/ai/stylist/reset': 'optional',
  'GET /api/ai/cs/history': 'optional',
  'POST /api/ai/cs/chat': 'optional',
  'POST /api/ai/cs/escalate': 'optional',
  'POST /api/ai/cs/reset': 'optional',
  'GET /api/ai/knowledge/articles': 'optional',
  'GET /api/ai/knowledge/articles/:slug': 'optional',
  'GET /api/ai/knowledge/categories': 'optional',
  'POST /api/ai/knowledge/ask': 'optional',
  'POST /api/ai/knowledge/articles/:id/helpful': 'optional',
};

/**
 * เส้นทางที่เปลี่ยนข้อมูลได้แต่ **ไม่ผ่าน `verifyOrigin`** — 3 เส้นทางนี้เท่านั้น
 * เหตุผลของแต่ละเส้นทางอยู่ในเอกสาร หัวข้อ CSRF
 */
const MUTATING_WITHOUT_CSRF = new Set([
  'POST /api/products/availability', // เป็นการอ่าน ไม่ได้เขียนอะไร
  'POST /api/looks/:slug/availability', // เป็นการอ่าน ไม่ได้เขียนอะไร
  'POST /api/payments/webhook/stripe', // ด่านคือลายเซ็น HMAC ของ raw body
]);

/**
 * เส้นทางที่ต้องคุมความถี่แบบเข้ม (20 ครั้ง/นาที) — ต้องตรงกับรายการนี้ **เป๊ะ**
 *
 * เกณฑ์: เรียก OpenAI (หนึ่งคำขอ = ค่าใช้จ่ายจริงของร้าน) หรือขยับตัวนับที่คนอื่นใช้ตัดสินใจ
 * ขาดไปแปลว่าบิลบานได้หรือปั่นตัวเลขได้ · เกินมาแปลว่าเผลอไปจำกัดเส้นทางที่ใช้งานปกติ
 */
const STRICT_RATE_LIMITED = new Set([
  'POST /api/reviews',
  'PATCH /api/reviews/:reviewId',
  'PATCH /api/reviews/:reviewId/helpful',
  'POST /api/ai/stylist/chat',
  'POST /api/ai/cs/chat',
  'POST /api/ai/knowledge/ask',
  'POST /api/ai/knowledge/articles/:id/helpful',
  'GET /api/ai/knowledge/articles/:slug', // เพิ่ม viewCount ที่ฐานข้อมูล
]);

/** เส้นทางที่รับไฟล์อัปโหลดได้ — มีแค่การนำเข้าข้อมูลของหลังบ้าน */
const UPLOAD_ROUTES = new Set([
  'POST /api/admin/import/products',
  'POST /api/admin/import/inventory',
]);

/** กลุ่มที่เอกสารประกาศว่า "ยังไม่มี" — ต้องไม่มีอยู่จริง */
const PLANNED_PREFIXES = ['/api/brands', '/api/coupons', '/api/returns', '/api/shipments'];

// ─── เอกสาร ────────────────────────────────────────────────────────────────

type DocRow = {
  method: string;
  path: string;
  auth: ApiRouteAuth | 'unknown';
  permissions: string[];
  strict: boolean;
};

const METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE)$/;

function parseRequirement(cell: string): Omit<DocRow, 'method' | 'path'> {
  const permissions = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);

  // ⚠️ ต้องเช็ค "ล็อกอินถ้ามี" ก่อน "ล็อกอิน" เพราะสตริงหลังเป็นส่วนหนึ่งของสตริงแรก
  const auth: ApiRouteAuth | 'unknown' =
    permissions.length > 0
      ? 'required'
      : cell.includes('ล็อกอินถ้ามี')
        ? 'optional'
        : cell.includes('ล็อกอิน')
          ? 'required'
          : cell.includes('สาธารณะ')
            ? 'public'
            : 'unknown';

  return { auth, permissions, strict: cell.includes('20/นาที') };
}

function parseDocRows(markdown: string): DocRow[] {
  const rows: DocRow[] = [];

  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;

    /**
     * แยกช่องด้วยขีดตั้งตรง ๆ และรับเฉพาะแถวที่มี 4 ช่องพอดี
     *
     * ⚠️ จึงเขียนขีดตั้งไว้ในเนื้อหาของตารางไม่ได้ (ต้องใช้เครื่องหมายอื่นคั่นค่าที่เลือกได้)
     *    ถ้าเผลอใส่ แถวนั้นจะถูกข้ามแล้ว endpoint นั้นจะกลายเป็น "ไม่ถูกบันทึกไว้"
     *    ซึ่งเทสต์ "ทุก endpoint ถูกเขียนไว้ในเอกสาร" จะฟ้องทันที ไม่ได้หายไปเงียบ ๆ
     */
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 4) continue;

    const [method, pathCell, requirement] = cells as [string, string, string, string];
    if (!METHOD_PATTERN.test(method)) continue;

    const pathMatch = /^`([^`]+)`$/.exec(pathCell);
    if (!pathMatch) continue;

    rows.push({ method, path: pathMatch[1] as string, ...parseRequirement(requirement) });
  }

  return rows;
}

const markdown = readFileSync(DOC_PATH, 'utf8');
const docRows = parseDocRows(markdown);
const docByKey = new Map(docRows.map((row) => [key(row), row]));

describe('แผนผัง API อ่านจาก Express router จริง', () => {
  it('อ่าน endpoint ได้ครบและมีจำนวนสมเหตุสมผล', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.every((route) => route.path.startsWith('/'))).toBe(true);
    expect(routes.some((route) => route.path.includes('//'))).toBe(false);
  });

  it('ไม่มีเส้นทางที่ Express เรียกไปไม่ถึง (ถูก /:param ที่มาก่อนจับไปแล้ว)', () => {
    // ข้อความ error บอกชื่อคู่ที่ชนกันตรง ๆ เพื่อให้แก้ลำดับได้ทันทีโดยไม่ต้องไปไล่หาเอง
    expect(
      unreachable.map((row) => `${row.method} ${row.path} ← ถูกจับก่อนโดย ${row.shadowedBy}`),
    ).toEqual([]);
  });

  it('ไม่มี method + path ซ้ำกัน', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const route of routes) {
      const id = key(route);
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }

    expect(duplicates).toEqual([]);
  });
});

describe('ด่านของทุกเส้นทางเป็นไปตามกฎ', () => {
  it('คำขอที่เปลี่ยนข้อมูลต้องผ่าน verifyOrigin ยกเว้นรายการที่ประกาศไว้', () => {
    const missing = routes
      .filter((route) => route.mutating && !route.csrf)
      .map(key)
      .filter((id) => !MUTATING_WITHOUT_CSRF.has(id));

    expect(missing).toEqual([]);
  });

  it('รายการข้อยกเว้นของ CSRF ไม่มีชื่อที่ไม่มีอยู่จริง', () => {
    const existing = new Set(routes.filter((route) => route.mutating).map(key));
    const stale = [...MUTATING_WITHOUT_CSRF].filter((id) => !existing.has(id));

    expect(stale).toEqual([]);
  });

  it('ทุกเส้นทางใต้ /api/admin ต้องล็อกอิน เป็นพนักงาน และมีสิทธิ์เฉพาะของงานนั้น', () => {
    const adminRoutes = routes.filter((route) => route.path.startsWith('/api/admin'));
    expect(adminRoutes.length).toBeGreaterThan(50);

    const offenders = adminRoutes
      .filter(
        (route) =>
          route.auth !== 'required' ||
          !route.roles.includes('EMPLOYEE') ||
          route.permissions.length === 0,
      )
      .map(key);

    expect(offenders).toEqual([]);
  });

  it('เส้นทางที่ไม่บังคับล็อกอินต้องอยู่ในรายการที่ประกาศไว้เท่านั้น', () => {
    const undeclared = routes
      .filter((route) => route.auth !== 'required')
      .filter((route) => GUEST_REACHABLE[key(route)] !== route.auth)
      .map((route) => `${key(route)} (auth=${route.auth})`);

    expect(undeclared).toEqual([]);
  });

  it('รายการเส้นทางที่เปิดให้ guest ไม่มีชื่อที่ไม่มีอยู่จริง', () => {
    const byKey = new Map(routes.map((route) => [key(route), route]));
    const stale = Object.keys(GUEST_REACHABLE).filter((id) => !byKey.has(id));

    expect(stale).toEqual([]);
  });

  it('เส้นทางที่คุมความถี่แบบเข้มตรงกับรายการที่ประกาศไว้เป๊ะ', () => {
    const actual = routes.filter((route) => route.rateLimit === 'strict').map(key);

    expect([...actual].sort()).toEqual([...STRICT_RATE_LIMITED].sort());
  });

  it('เส้นทางที่รับไฟล์อัปโหลดตรงกับรายการที่ประกาศไว้เป๊ะ', () => {
    const actual = routes.filter((route) => route.upload !== null).map(key);

    expect([...actual].sort()).toEqual([...UPLOAD_ROUTES].sort());
  });
});

describe('docs/09-api-reference.md ตรงกับโค้ด', () => {
  it('อ่านตารางในเอกสารได้', () => {
    expect(docRows.length).toBeGreaterThan(100);
    expect(docRows.every((row) => row.auth !== 'unknown')).toBe(true);
  });

  it('ทุก endpoint ที่มีอยู่จริงถูกเขียนไว้ในเอกสาร', () => {
    const undocumented = routes.map(key).filter((id) => !docByKey.has(id));

    expect(undocumented).toEqual([]);
  });

  it('ไม่มีแถวในเอกสารที่ไม่มี endpoint จริงรองรับ', () => {
    const real = new Set(routes.map(key));
    const ghosts = docRows.map(key).filter((id) => !real.has(id));

    expect(ghosts).toEqual([]);
  });

  it('สิทธิ์และเงื่อนไขการล็อกอินในเอกสารตรงกับด่านจริง', () => {
    const mismatches: string[] = [];

    for (const route of routes) {
      const row = docByKey.get(key(route));
      if (!row) continue;

      if (row.auth !== route.auth) {
        mismatches.push(`${key(route)}: เอกสารว่า auth=${row.auth} แต่โค้ดเป็น ${route.auth}`);
      }

      const documented = [...row.permissions].sort().join(',');
      const actual = [...route.permissions].sort().join(',');

      if (documented !== actual) {
        mismatches.push(`${key(route)}: เอกสารว่าสิทธิ์ [${documented}] แต่โค้ดเป็น [${actual}]`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('เครื่องหมาย 20/นาที ในเอกสารตรงกับ rate limit จริง', () => {
    const mismatches = routes
      .filter((route) => {
        const row = docByKey.get(key(route));
        return row ? row.strict !== (route.rateLimit === 'strict') : false;
      })
      .map(key);

    expect(mismatches).toEqual([]);
  });

  it('จำนวนเส้นทางที่เขียนไว้ต้นเอกสารตรงกับจำนวนจริง', () => {
    const stated = /\*\*(\d+) เส้นทาง\*\*/.exec(markdown);

    expect(stated).not.toBeNull();
    expect(Number(stated?.[1])).toBe(routes.length);
  });
});

describe('GET /api', () => {
  it('สรุปทุกกลุ่มด้วยตัวเลขที่มาจาก router จริง', async () => {
    const response = await request(app).get('/api');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const data = response.body.data as {
      totalEndpoints: number;
      groups: { path: string; endpoints: number; methods: string[] }[];
    };

    // ทุกกลุ่มต้องมี endpoint จริง — กลุ่มที่ว่างเปล่าคือกลุ่มที่โน้ตพูดถึงของที่ไม่มี
    for (const group of data.groups) {
      expect(group.endpoints, `${group.path} ไม่มี endpoint เลย`).toBeGreaterThan(0);
      expect(group.methods.length).toBeGreaterThan(0);
    }

    const sum = data.groups.reduce((total, group) => total + group.endpoints, 0);
    // +1 คือตัว GET /api เองที่ไม่ได้อยู่ในกลุ่มไหน
    expect(sum + 1).toBe(data.totalEndpoints);

    const prefixes = data.groups.map((group) => group.path);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.every((prefix) => prefix.startsWith('/api/'))).toBe(true);
  });

  it('ไม่ปนกลุ่มที่ยังไม่มีเข้ากับกลุ่มที่เรียกได้', async () => {
    const response = await request(app).get('/api');
    const data = response.body.data as {
      groups: { path: string }[];
      planned: { path: string }[];
    };

    const live = new Set(data.groups.map((group) => group.path));
    for (const planned of data.planned) {
      expect(live.has(planned.path)).toBe(false);
    }
  });

  it('ทุกกลุ่มที่ประกาศว่ายังไม่มี ต้องได้ 404 จริง', async () => {
    for (const prefix of PLANNED_PREFIXES) {
      const response = await request(app).get(prefix);

      expect(response.status, `${prefix} ต้องยังไม่มี`).toBe(404);
      expect(response.body.errorCode).toBe('NOT_FOUND');
    }
  });

  it('รายการที่ประกาศว่ายังไม่มี ตรงกับที่เอกสารเขียนไว้', async () => {
    const response = await request(app).get('/api');
    const data = response.body.data as { planned: { path: string }[] };

    expect(data.planned.map((group) => group.path).sort()).toEqual([...PLANNED_PREFIXES].sort());
    for (const prefix of PLANNED_PREFIXES) {
      expect(markdown).toContain(`\`${prefix}\``);
    }
  });
});

describe('รูปแบบ response มาตรฐาน', () => {
  it('endpoint ที่ไม่มีจริงคืน 404 ตาม shape เดียวกับทุก error', async () => {
    const response = await request(app).get('/api/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, errorCode: 'NOT_FOUND' });
    expect(typeof response.body.message).toBe('string');
  });

  it('เส้นทางที่มีอยู่แต่เมธอดไม่ถูกก็คืน 404 ตาม shape เดียวกัน', async () => {
    // Express ไม่มี 405 ให้เอง — สำคัญที่ client ได้ shape เดิมเสมอ ไม่ใช่หน้า HTML ของ Express
    const response = await request(app).delete('/api/products/search');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe('NOT_FOUND');
  });

  it('ตัวอย่าง route ทุกชนิดมีข้อมูลด่านครบใน DTO', () => {
    const sample = routes.find((route) => route.path === '/api/admin/logs') as ApiRoute;

    expect(sample).toMatchObject({
      method: 'GET',
      auth: 'required',
      csrf: true,
      rateLimit: 'global',
      upload: null,
      mutating: false,
    });
    expect(sample.permissions).toEqual(['log:read']);
    expect(sample.roles).toEqual(['EMPLOYEE', 'ADMIN', 'SUPER_ADMIN']);
  });
});
