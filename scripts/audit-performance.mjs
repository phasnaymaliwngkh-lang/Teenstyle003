#!/usr/bin/env node
/**
 * ตรวจประสิทธิภาพด้วยข้อมูล "ปริมาณจริง" (STEP 34)
 *
 * ทำไมต้องมีเครื่องมือนี้ ไม่ใช่แค่จับเวลาบนฐานข้อมูล dev
 *   ฐานข้อมูล dev มีสินค้า 12 ชิ้นและคำสั่งซื้อ 0 ใบ ทุกคิวรีจึงเร็วเท่ากันหมด
 *   และ PostgreSQL เลือก Seq Scan ทุกครั้งเพราะตารางเล็กกว่าที่ index จะคุ้ม
 *   → **วัดที่ dev ไม่มีทางเห็นปัญหาเรื่องประสิทธิภาพเลย** คิวรีที่โตแบบ O(สินค้า × ออเดอร์)
 *     กับคิวรีที่โตแบบคงที่ ให้ตัวเลขเท่ากันจนกว่าจะมีข้อมูลจริง
 *
 * สิ่งที่สคริปต์นี้ทำ
 *   1. สร้างฐานข้อมูลใหม่แยกต่างหาก (ไม่แตะฐานข้อมูลของแอปเลย)
 *   2. ลง migration ชุดเดียวกับของจริง แล้วเติมข้อมูลปริมาณจริง
 *   3. เปิด **backend ตัวจริง** ชี้ไปฐานข้อมูลนั้น (ไม่ได้ก็อป SQL มาไว้ในสคริปต์
 *      เพราะ SQL ที่ก็อปไว้จะเพี้ยนจากโค้ดจริงเมื่อไรก็ได้ แล้วเครื่องมือจะโกหก)
 *   4. ยิงทุก endpoint ที่หนัก วัดเวลา + นับจำนวนทรานแซกชันที่ฐานข้อมูลต่อคำขอ
 *   5. เทียบกับงบเวลา (budget) ต่อเส้นทาง แล้วลบฐานข้อมูลทิ้ง
 *
 * งบเวลาไม่ใช่ "เร็วที่สุดที่ทำได้" แต่เป็น **เพดานที่ถ้าเกินแปลว่ามีอะไรผิดเชิงโครงสร้าง**
 * (ตั้งไว้ราว 2–3 เท่าของค่าที่วัดได้จริงตอนปิด STEP 34 บนเครื่องพัฒนา)
 * เครื่องช้ากว่านี้อาจต้องปรับ — ให้ปรับทั้งตารางพร้อมกันและบันทึกเหตุผล
 *
 * วิธีใช้
 *   node scripts/audit-performance.mjs            ตรวจแล้วลบฐานข้อมูลทิ้ง
 *   node scripts/audit-performance.mjs --keep     เก็บฐานข้อมูลไว้ไล่ดู EXPLAIN เอง
 *   node scripts/audit-performance.mjs --reuse    ใช้ฐานข้อมูลที่ --keep ไว้ (ข้ามการเติมข้อมูล)
 *
 * exit code 0 = ผ่านทุกงบ · 1 = มีเส้นทางเกินงบ หรือยิงไม่สำเร็จ
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
process.loadEnvFile(path.join(ROOT, '.env'));

const KEEP = process.argv.includes('--keep');
const REUSE = process.argv.includes('--reuse');

/** ฐานข้อมูลชั่วคราวของเครื่องมือนี้ — ห้ามซ้ำกับฐานข้อมูลของแอป */
const SCRATCH_DB = 'teenstyle_perf_audit';
/** พอร์ตของ backend ที่เครื่องมือนี้เปิดเอง — ไม่ชนกับ dev (4000) */
const PORT = 4199;

// ─────────────────────────────────────────────────────────────────────────────
// psql
// ─────────────────────────────────────────────────────────────────────────────

/** ที่อยู่ psql — บนเครื่องนี้ PostgreSQL 18 ติดตั้งแบบ installer จึงไม่อยู่ใน PATH */
function findPsql() {
  const candidates = [
    process.env.PSQL,
    ...[18, 17, 16, 15].map((v) => `C:/Program Files/PostgreSQL/${v}/bin/psql.exe`),
  ].filter((entry) => entry !== undefined);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Linux/macOS หรือ Windows ที่ใส่ PATH ไว้แล้ว
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return 'psql';
  } catch {
    throw new Error(
      'หา psql ไม่เจอ — ตั้ง env PSQL ให้ชี้ไปที่ psql ของเครื่องนี้ก่อนรันเครื่องมือนี้',
    );
  }
}

const PSQL = findPsql();
/*
 * เรียก CLI ผ่าน node ตรง ๆ ไม่ผ่าน npx
 *   - spawn ด้วย shell: true ทำให้ Node เตือนว่า argument ไม่ถูก escape
 *   - spawn "npx.cmd" แบบไม่มี shell ถูก Node ปฏิเสธด้วย EINVAL
 *     (มาตรการกัน command injection ของ Windows ตั้งแต่ Node 20)
 *   → ชี้ไปที่ไฟล์ CLI ในโปรเจกต์เลย แน่นอนกว่าและได้เวอร์ชันของโปรเจกต์
 */
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const SQL_DIR = mkdtempSync(path.join(tmpdir(), 'teenstyle-perf-'));

function parseDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('ไม่มี DATABASE_URL ใน .env');

  const url = new URL(raw);
  const appDb = url.pathname.replace(/^\//, '');

  if (appDb === SCRATCH_DB) {
    throw new Error(
      `DATABASE_URL ชี้ไปที่ ${SCRATCH_DB} ซึ่งเป็นชื่อฐานข้อมูลชั่วคราวของเครื่องมือนี้`,
    );
  }

  return {
    appDb,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port || '5432',
    scratchUrl: `${url.protocol}//${url.username}:${url.password}@${url.host}/${SCRATCH_DB}?schema=public`,
  };
}

const DB = parseDatabaseUrl();

/**
 * ส่ง SQL ผ่าน **ไฟล์** ไม่ใช่ argument
 * (argument ที่มีภาษาไทยถูกแปลงเป็น ANSI บน Windows แล้ว PostgreSQL ปฏิเสธว่า
 *  "invalid byte sequence for encoding UTF8" — เจอจริงตอนเขียนเครื่องมือนี้)
 */
function psql(sql, { db = SCRATCH_DB, silent = true } = {}) {
  const file = path.join(SQL_DIR, 'query.sql');
  writeFileSync(file, sql, 'utf8');

  return execFileSync(
    PSQL,
    [
      '-U',
      DB.user,
      '-h',
      DB.host,
      '-p',
      DB.port,
      '-d',
      db,
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      file,
    ],
    {
      env: { ...process.env, PGPASSWORD: DB.password, PGCLIENTENCODING: 'UTF8' },
      encoding: 'utf8',
      stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ข้อมูลปริมาณจริง
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ปริมาณที่ใช้วัด — เลือกให้ "ร้านที่โตแล้วแต่ยังไม่ใหญ่มาก"
 * ใหญ่พอที่ planner จะเลือก index (ตารางเกิน shared_buffers) แต่ยังโหลดเสร็จในไม่กี่สิบวินาที
 */
const VOLUME = {
  users: 20_000,
  products: 5_000,
  variantsPerProduct: 4,
  orders: 60_000,
  reviews: 20_000,
  notifications: 120_000,
  adminLogs: 150_000,
  movements: 100_000,
  wishlist: 60_000,
};

const PERMISSION_KEYS = [
  'product:read',
  'product:create',
  'product:update',
  'product:delete',
  'catalog:manage',
  'inventory:read',
  'inventory:adjust',
  'order:read',
  'order:read:own',
  'order:update',
  'order:cancel',
  'order:refund',
  'payment:read',
  'payment:refund',
  'shipment:read',
  'shipment:update',
  'customer:read',
  'customer:update',
  'review:create',
  'review:moderate',
  'wishlist:manage',
  'coupon:manage',
  'look:manage',
  'ai:read',
  'ai:handoff',
  'ai:knowledge:manage',
  'analytics:read',
  'log:read',
  'settings:manage',
  'user:role:manage',
  'backup:manage',
];

const STAFF_TOKEN = 'perf-audit-staff-token';

/**
 * ⚠️ ห้ามใช้ `ORDER BY … LIMIT 1 OFFSET n` เพื่อสุ่มแถวอ้างอิงต่อแถวที่แทรก
 *    (เขียนแบบนั้นครั้งแรกแล้วใช้เวลา 5 นาที 36 วินาที เพราะสแกนซ้ำทุกแถว)
 *    ใช้ตารางชั่วคราวที่มีเลขลำดับแล้ว join ด้วย modulo → 27 วินาที
 */
const VOLUME_SQL = `
SET client_min_messages = warning;
SELECT setseed(0.42);

INSERT INTO "Role" (id, name, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r::"RoleName", now(), now()
FROM unnest(ARRAY['CUSTOMER','EMPLOYEE','ADMIN','SUPER_ADMIN']) r;

INSERT INTO "Permission" (id, key, "createdAt")
SELECT gen_random_uuid(), k, now() FROM unnest(ARRAY[${PERMISSION_KEYS.map((k) => `'${k}'`).join(',')}]) k;

INSERT INTO "_PermissionToRole" ("A","B")
SELECT p.id, r.id FROM "Permission" p CROSS JOIN "Role" r WHERE r.name = 'SUPER_ADMIN';

INSERT INTO "Category" (id, name, slug, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'หมวดหมู่ ' || g, 'category-' || g, g, true, now(), now()
FROM generate_series(1, 30) g;

INSERT INTO "Brand" (id, name, slug, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'แบรนด์ ' || g, 'brand-' || g, true, now(), now()
FROM generate_series(1, 20) g;

INSERT INTO "Color" (id, name, slug, hex, "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'สี ' || g, 'color-' || g, '#1122' || lpad(g::text, 2, '0'), g, now(), now()
FROM generate_series(1, 12) g;

INSERT INTO "Size" (id, name, code, "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ไซซ์ ' || g, 'SZ' || g, g, now(), now()
FROM generate_series(1, 8) g;

INSERT INTO "User" (id, email, name, phone, "roleId", status, "loyaltyTier", points, "totalSpent",
                    "allowPersonalization", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'customer' || g || '@example.com', 'ลูกค้าทดสอบ หมายเลข ' || g,
       '08' || lpad(g::text, 8, '0'),
       (SELECT id FROM "Role" WHERE name = 'CUSTOMER'),
       CASE WHEN g % 97 = 0 THEN 'SUSPENDED'::"UserStatus" ELSE 'ACTIVE'::"UserStatus" END,
       'MEMBER', 0, 0, true, now() - (g % 700) * interval '1 day', now()
FROM generate_series(1, ${VOLUME.users}) g;

INSERT INTO "Product" (id, name, slug, description, sku, price, "salePrice", "categoryId", "brandId",
                       status, "minimumStock", "totalStock", tags, "publishedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'เสื้อผ้าทดสอบรุ่นที่ ' || g, 'product-' || g,
       'คำอธิบายสินค้าทดสอบสำหรับวัดประสิทธิภาพ หมายเลข ' || g,
       'SKU-P-' || lpad(g::text, 6, '0'),
       (200 + (g % 40) * 50)::numeric(12, 2),
       CASE WHEN g % 5 = 0 THEN (150 + (g % 40) * 45)::numeric(12, 2) ELSE NULL END,
       (SELECT id FROM "Category" ORDER BY slug LIMIT 1 OFFSET (g % 30)),
       (SELECT id FROM "Brand" ORDER BY slug LIMIT 1 OFFSET (g % 20)),
       CASE WHEN g % 20 = 0 THEN 'DRAFT'::"ProductStatus"
            WHEN g % 33 = 0 THEN 'ARCHIVED'::"ProductStatus"
            ELSE 'ACTIVE'::"ProductStatus" END,
       5, 0, ARRAY['tag' || (g % 15)],
       now() - (g % 500) * interval '1 day', now() - (g % 500) * interval '1 day', now()
FROM generate_series(1, ${VOLUME.products}) g;

INSERT INTO "ProductImage" (id, "productId", url, alt, "sortOrder", "isMain", "createdAt")
SELECT gen_random_uuid(), p.id, 'https://images.unsplash.com/photo-' || i || '?w=800',
       'รูปสินค้า ' || p.name, i, i = 0, now()
FROM "Product" p, generate_series(0, 1) i;

INSERT INTO "ProductVariant" (id, "productId", sku, "colorId", "sizeId", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p.id, 'SKU-V-' || substr(p.id::text, 1, 8) || '-' || v,
       (SELECT id FROM "Color" ORDER BY slug LIMIT 1 OFFSET (v % 12)),
       (SELECT id FROM "Size" ORDER BY code LIMIT 1 OFFSET (v % 8)),
       v < ${VOLUME.variantsPerProduct}, now(), now()
FROM "Product" p, generate_series(0, ${VOLUME.variantsPerProduct - 1}) v;

INSERT INTO "Inventory" (id, "variantId", quantity, "reservedQuantity", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.id, q.quantity, least(q.quantity, (abs(hashtext(v.id::text)) % 4)), now(), now()
FROM "ProductVariant" v
CROSS JOIN LATERAL (SELECT (abs(hashtext(v.id::text)) % 40) AS quantity) q;

UPDATE "Product" p SET "totalStock" = s.total
FROM (SELECT v."productId" AS pid, sum(i.quantity) AS total
      FROM "ProductVariant" v JOIN "Inventory" i ON i."variantId" = v.id
      GROUP BY v."productId") s
WHERE s.pid = p.id;

CREATE TEMP TABLE u AS SELECT id, row_number() OVER (ORDER BY email) - 1 AS n FROM "User";
CREATE TEMP TABLE p AS SELECT id, price, row_number() OVER (ORDER BY slug) - 1 AS n FROM "Product";
CREATE TEMP TABLE v AS SELECT id, sku, "productId", row_number() OVER (ORDER BY sku) - 1 AS n FROM "ProductVariant";
-- ตัวเลือกตัวแรกของแต่ละสินค้า (ใช้ตอนสร้างรายการในบิล ให้ได้หนึ่งแถวต่อสินค้าแน่นอน)
CREATE TEMP TABLE v_first AS
  SELECT DISTINCT ON ("productId") id, sku, "productId" FROM "ProductVariant" ORDER BY "productId", sku;
CREATE INDEX ON u (n); CREATE INDEX ON p (n); CREATE INDEX ON v (n); CREATE INDEX ON v_first ("productId");
ANALYZE u; ANALYZE p; ANALYZE v; ANALYZE v_first;

INSERT INTO "Order" (id, "orderNumber", "userId", status, "paymentStatus", subtotal, "discountTotal",
                     "shippingFee", total, "addressSnapshot", "shippingMethod", "paidAt",
                     "deliveredAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'TS-PERF-' || lpad(g::text, 7, '0'), u.id,
       CASE WHEN g % 11 = 0 THEN 'PENDING_PAYMENT'::"OrderStatus"
            WHEN g % 13 = 0 THEN 'CANCELLED'::"OrderStatus"
            WHEN g % 7 = 0 THEN 'SHIPPING'::"OrderStatus"
            ELSE 'DELIVERED'::"OrderStatus" END,
       CASE WHEN g % 11 = 0 THEN 'PENDING'::"PaymentStatus"
            WHEN g % 13 = 0 THEN 'CANCELLED'::"PaymentStatus"
            ELSE 'PAID'::"PaymentStatus" END,
       (500 + (g % 90) * 30)::numeric(12, 2), 0, 50, (550 + (g % 90) * 30)::numeric(12, 2),
       '{"fullName":"ผู้รับทดสอบ","province":"กรุงเทพมหานคร"}'::jsonb, 'STANDARD',
       CASE WHEN g % 11 = 0 THEN NULL ELSE now() - (g % 400) * interval '1 day' + interval '3 hour' END,
       CASE WHEN g % 11 = 0 OR g % 13 = 0 THEN NULL ELSE now() - (g % 400) * interval '1 day' + interval '2 day' END,
       now() - (g % 400) * interval '1 day', now()
FROM generate_series(1, ${VOLUME.orders}) g
JOIN u ON u.n = g % ${VOLUME.users};

INSERT INTO "OrderItem" (id, "orderId", "productId", "variantId", "productName", "variantSku",
                         "unitPrice", quantity, "lineTotal", "createdAt")
SELECT gen_random_uuid(), o.id, p.id, v_first.id, prod.name, v_first.sku, p.price, 1 + (line_no % 2),
       (p.price * (1 + (line_no % 2)))::numeric(12, 2), o."createdAt"
FROM "Order" o
CROSS JOIN LATERAL generate_series(0, (abs(hashtext(o.id::text)) % 3)) AS line_no
JOIN p ON p.n = (abs(hashtext(o.id::text || line_no::text)) % ${VOLUME.products})
JOIN v_first ON v_first."productId" = p.id
JOIN "Product" prod ON prod.id = p.id;

INSERT INTO "Review" (id, "productId", "userId", rating, comment, "isVerifiedPurchase", status,
                      "helpfulCount", "createdAt", "updatedAt")
SELECT DISTINCT ON (u.id, p.id) gen_random_uuid(), p.id, u.id,
       1 + (abs(hashtext(u.id::text || p.id::text)) % 5),
       'ความเห็นทดสอบเพื่อวัดประสิทธิภาพของคิวรีรีวิว ข้อความยาวพอประมาณเพื่อให้ขนาดแถวใกล้ของจริง',
       true,
       CASE WHEN abs(hashtext(p.id::text || u.id::text)) % 10 = 0 THEN 'PENDING'::"ReviewStatus"
            ELSE 'APPROVED'::"ReviewStatus" END,
       abs(hashtext(u.id::text)) % 30,
       now() - (abs(hashtext(u.id::text)) % 300) * interval '1 day', now()
FROM generate_series(1, ${VOLUME.reviews}) g
JOIN p ON p.n = g % ${VOLUME.products}
JOIN u ON u.n = (g * 7) % ${VOLUME.users};

INSERT INTO "Wishlist" (id, "userId", "productId", "priceWhenAdded", "notifyOnPriceDrop", "createdAt")
SELECT gen_random_uuid(), u.id, p.id, p.price, true, now() - (g % 200) * interval '1 day'
FROM generate_series(1, ${VOLUME.wishlist}) g
JOIN u ON u.n = g % ${VOLUME.users}
JOIN p ON p.n = (g * 13) % ${VOLUME.products}
ON CONFLICT DO NOTHING;

INSERT INTO "Notification" (id, "userId", type, channel, status, title, body, "sentAt", "readAt", "createdAt")
SELECT gen_random_uuid(), u.id,
       (ARRAY['ORDER_UPDATE','SHIPPING','PAYMENT_SUCCESS','PRICE_DROP','SYSTEM'])[1 + g % 5]::"NotificationType",
       'IN_APP', 'SENT', 'แจ้งเตือนทดสอบ ' || g,
       'เนื้อหาการแจ้งเตือนทดสอบเพื่อวัดประสิทธิภาพ หมายเลข ' || g,
       now() - (g % 300) * interval '1 day',
       CASE WHEN g % 3 = 0 THEN now() - (g % 300) * interval '1 day' + interval '1 hour' ELSE NULL END,
       now() - (g % 300) * interval '1 day'
FROM generate_series(1, ${VOLUME.notifications}) g
JOIN u ON u.n = g % ${VOLUME.users};

INSERT INTO "AdminLog" (id, "userId", action, "targetType", "targetId", before, after,
                        "ipAddress", "userAgent", "createdAt")
SELECT gen_random_uuid(), u.id,
       (ARRAY['product.update','inventory.adjust','order.status.update','customer.status.update','knowledge.article.update'])[1 + g % 5],
       (ARRAY['PRODUCT','INVENTORY','ORDER','User','KnowledgeArticle'])[1 + g % 5],
       p.id::text, '{"status":"DRAFT"}'::jsonb, '{"status":"ACTIVE"}'::jsonb,
       '203.0.113.' || (g % 254 + 1), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
       now() - (g % 365) * interval '1 day'
FROM generate_series(1, ${VOLUME.adminLogs}) g
JOIN u ON u.n = g % 50
JOIN p ON p.n = g % ${VOLUME.products};

INSERT INTO "InventoryMovement" (id, "variantId", type, quantity, "quantityBefore", "quantityAfter",
                                 reason, "referenceType", "referenceId", "userId", "createdAt")
SELECT gen_random_uuid(), v.id,
       (ARRAY['STOCK_IN','STOCK_OUT','ADJUSTMENT','RETURN'])[1 + g % 4]::"InventoryMovementType",
       1 + g % 5, 10, 10 + (g % 5), 'เหตุผลทดสอบสำหรับวัดประสิทธิภาพ', 'ORDER', NULL, u.id,
       now() - (g % 365) * interval '1 day'
FROM generate_series(1, ${VOLUME.movements}) g
JOIN v ON v.n = g % ${VOLUME.products * VOLUME.variantsPerProduct}
JOIN u ON u.n = g % 50;

-- บัญชีพนักงานหนึ่งคน + session ที่ยังไม่หมดอายุ เพื่อยิง endpoint หลังบ้านได้
UPDATE "User" SET "roleId" = (SELECT id FROM "Role" WHERE name='SUPER_ADMIN')
WHERE email = 'customer1@example.com';

INSERT INTO "Session" ("sessionToken","userId",expires,"createdAt","updatedAt")
SELECT '${STAFF_TOKEN}', id, now() + interval '1 day', now(), now()
FROM "User" WHERE email='customer1@example.com';

ANALYZE;
`;

// ─────────────────────────────────────────────────────────────────────────────
// เส้นทางที่วัด + งบเวลา
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `budgetMs` = เพดานเวลาตอบกลับ (median ของ 3 ครั้ง)
 * `note` = สิ่งที่เส้นทางนี้เคยพลาด เพื่อให้คนอ่านผลรู้ว่ากำลังกันอะไร
 */
const ROUTES = [
  { path: '/api/products?limit=24', budgetMs: 300, note: 'หน้าแรก' },
  { path: '/api/products/search?limit=24', budgetMs: 300, note: '/shop เรียงล่าสุด' },
  {
    path: '/api/products/search?sort=bestselling&limit=24',
    budgetMs: 400,
    note: 'เคยเป็น subquery ต่อแถว → 552ms',
  },
  {
    path: '/api/products/search?sort=popular&limit=24',
    budgetMs: 300,
    note: 'เคยนับ Wishlist ต่อแถว',
  },
  {
    path: '/api/products/search?inStock=true&limit=24',
    budgetMs: 300,
    note: 'เคยรวมสต็อกต่อแถว → 92ms ต่อคิวรี',
  },
  { path: '/api/products/filters', budgetMs: 250, note: 'เคยนับสินค้าใหม่ทุกหมวด (30 รอบ)' },
  { path: '/api/products/product-1', budgetMs: 250, note: 'หน้าสินค้า' },
  { path: '/api/products/product-1/reviews?limit=10', budgetMs: 250, note: 'รีวิวในหน้าสินค้า' },
  { path: '/api/looks/search?limit=12', budgetMs: 300, note: '/looks' },
  {
    path: '/api/admin/overview',
    budgetMs: 700,
    note: 'dashboard — หนักที่สุดของหลังบ้าน',
    staff: true,
  },
  { path: '/api/admin/orders?limit=20', budgetMs: 300, staff: true },
  {
    path: '/api/admin/orders?q=TS-PERF-0001234&limit=20',
    budgetMs: 250,
    note: 'เคยเป็น OR ข้ามตาราง → 313ms',
    staff: true,
  },
  {
    path: '/api/admin/orders?q=' + encodeURIComponent('หมายเลข 1234') + '&limit=20',
    budgetMs: 300,
    note: 'ค้นด้วยชื่อลูกค้า — เคย 411ms ที่ชั้น SQL',
    staff: true,
  },
  { path: '/api/admin/products?limit=20', budgetMs: 400, note: 'เคยรวมสต็อกต่อแถว', staff: true },
  { path: '/api/admin/products?lowStock=true&limit=20', budgetMs: 400, staff: true },
  { path: '/api/admin/inventory?limit=20', budgetMs: 300, staff: true },
  { path: '/api/admin/inventory/movements?limit=20', budgetMs: 300, staff: true },
  {
    path: '/api/admin/stock-alerts',
    budgetMs: 500,
    note: 'สแกนทุกตัวเลือกที่ขายอยู่',
    staff: true,
  },
  { path: '/api/admin/customers?limit=20', budgetMs: 300, staff: true },
  {
    path: '/api/admin/customers?q=customer123&limit=20',
    budgetMs: 250,
    note: 'เคยสแกน User ทั้งตาราง',
    staff: true,
  },
  { path: '/api/admin/logs?limit=20', budgetMs: 300, staff: true },
  { path: '/api/admin/logs/filters', budgetMs: 400, staff: true },
  { path: '/api/admin/reviews?limit=20', budgetMs: 300, staff: true },
  { path: '/api/admin/analytics/summary', budgetMs: 400, note: 'ช่วงเริ่มต้น 30 วัน', staff: true },
  {
    path: '/api/admin/analytics/summary?from=2025-09-27&to=2026-09-26&granularity=month',
    budgetMs: 600,
    note: 'ช่วงกว้างสุดที่ระบบยอม (366 วัน)',
    staff: true,
  },
  { path: '/api/admin/analytics/products?limit=20', budgetMs: 500, staff: true },
  { path: '/api/admin/analytics/customers?limit=20', budgetMs: 400, staff: true },
  {
    path: '/api/admin/analytics/breakdown?from=2025-09-27&to=2026-09-26',
    budgetMs: 1200,
    note: '5 คิวรีรวมยอดพร้อมกันทั้งปี — หนักโดยธรรมชาติ',
    staff: true,
  },
  { path: '/api/notifications?limit=20', budgetMs: 250, staff: true },
  { path: '/api/wishlist?limit=20', budgetMs: 300, staff: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// ขั้นตอน
// ─────────────────────────────────────────────────────────────────────────────

function log(message) {
  console.log(message);
}

function createScratchDatabase() {
  log(`• สร้างฐานข้อมูล ${SCRATCH_DB} (ฐานข้อมูลของแอปคือ ${DB.appDb} — ไม่ถูกแตะ)`);
  psql(`DROP DATABASE IF EXISTS "${SCRATCH_DB}";`, { db: 'postgres' });
  psql(`CREATE DATABASE "${SCRATCH_DB}";`, { db: 'postgres' });
}

function runMigrations() {
  log('• ลง migration ชุดเดียวกับของจริง');
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: path.join(ROOT, 'database'),
    env: { ...process.env, DATABASE_URL: DB.scratchUrl },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function loadVolume() {
  const rows = Object.entries(VOLUME)
    .map(([key, value]) => `${key} ${value.toLocaleString('en-US')}`)
    .join(' · ');
  log(`• เติมข้อมูล: ${rows}`);
  const started = Date.now();
  psql(VOLUME_SQL);
  log(`  เสร็จใน ${((Date.now() - started) / 1000).toFixed(0)} วินาที`);
}

let backend = null;

async function startBackend() {
  log(`• เปิด backend ตัวจริงที่พอร์ต ${PORT} ชี้ไปฐานข้อมูลนั้น`);

  /*
   * ⚠️ ต้อง **ลบ** PORT ออก ไม่ใช่ตั้งเป็นค่าว่าง
   *    config/env.ts ใช้ z.coerce.number() ซึ่งแปลงสตริงว่างเป็น 0 แล้วตกเงื่อนไข min(1)
   *    → backend ไม่ขึ้นเลยพร้อมข้อความว่า "PORT: Too small"
   *    และ PORT ต้องชนะ BACKEND_PORT ตามดีไซน์ จึงปล่อยให้ค้างมาจาก .env ไม่ได้
   */
  const childEnv = { ...process.env };
  delete childEnv.PORT;

  backend = spawn(process.execPath, [TSX_CLI, 'src/server.ts'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...childEnv,
      DATABASE_URL: DB.scratchUrl,
      BACKEND_PORT: String(PORT),
      // เครื่องมือนี้ยิงรัว ๆ จาก IP เดียว — ต้องไม่ไปชน rate limit ของตัวเอง
      // (ถ้าชน หน้าเว็บจะตอบแผง error สั้น ๆ ซึ่งเร็วและ "ผ่าน" แบบหลอก ๆ — บทเรียน STEP 31)
      RATE_LIMIT_MAX: '1000000',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  backend.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // ยังไม่ขึ้น
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`backend ไม่ขึ้นภายใน 30 วินาที\n${stderr.slice(-2000)}`);
}

function stopBackend() {
  if (!backend) return;
  // ต้องปิดทั้ง tree — ฆ่าแค่ลูกที่ฟัง port แล้วตัวแม่จะเปิดใหม่ให้ (บทเรียนจาก dev server)
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(backend.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch {
      backend.kill('SIGKILL');
    }
  } else {
    backend.kill('SIGKILL');
  }
  backend = null;
}

/*
 * ⚠️ ที่นี่เคยมีคอลัมน์ "ยิง SQL กี่ครั้งต่อคำขอ" ที่อ่านจาก pg_stat_database.xact_commit
 *    **ถอดออกเพราะมันโกหก** — PostgreSQL 15+ ไม่ flush สถิติของ backend อื่นทันที
 *    (รอได้ถึงราว 1 วินาที) อ่านต่อจากคำขอเลยจึงได้เลขต่ำกว่าความจริงแบบสุ่ม
 *    เทียบกับ log จริงแล้ว: dashboard ยิง 59 statement แต่คอลัมน์นี้รายงาน 10
 *    ตัวเลขที่ผิดแบบเดาไม่ได้แย่กว่าไม่มีตัวเลข (กฎเดียวกับป้ายกระดิ่งของ STEP 16)
 *
 *    ถ้าต้องนับจำนวนคิวรีต่อคำขอจริง ๆ ให้เปิด log ของ PostgreSQL แทน:
 *      ALTER DATABASE teenstyle_perf_audit SET log_min_duration_statement = 0;
 *    แล้วอ่านไฟล์ใน <data_directory>/log — ได้ทั้งจำนวนและเวลาต่อ statement
 *    (วิธีนี้คือวิธีที่ใช้หาปัญหาทั้งหมดของ STEP 34)
 */

async function request(route) {
  const headers = route.staff ? { Authorization: `Bearer ${STAFF_TOKEN}` } : {};
  const started = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}${route.path}`, { headers });
  const body = await res.text();
  return { ms: performance.now() - started, status: res.status, bytes: body.length };
}

async function measure() {
  const results = [];

  for (const route of ROUTES) {
    /*
     * วอร์มสองครั้งก่อนวัด ไม่นับผล
     *   ครั้งแรกจ่ายค่าเปิด connection + วางแผนคิวรีครั้งแรก
     *   ครั้งที่สองจ่ายค่าอ่าน index/heap เข้ามาใน shared_buffers
     * ถ้าวอร์มครั้งเดียว ฐานข้อมูลที่เพิ่งสร้างใหม่จะให้ตัวเลขสูงกว่าปกติ 3–4 เท่า
     * แล้วเครื่องมือจะเตือนผิด ๆ ในรอบแรกเสมอ (ซึ่งทำให้คนเลิกเชื่อผลตรวจ)
     */
    await request(route);
    await request(route);

    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await request(route));

    runs.sort((a, b) => a.ms - b.ms);
    const median = runs[1];

    results.push({
      route,
      ms: median.ms,
      status: median.status,
      bytes: median.bytes,
      over: median.ms > route.budgetMs,
      failed: median.status >= 400,
    });
  }

  return results;
}

function report(results) {
  const width = Math.max(...results.map((r) => r.route.path.length), 20);
  log('');
  log(
    'เส้นทาง'.padEnd(width) + 'เวลา'.padStart(9) + 'งบ'.padStart(8) + 'ขนาด'.padStart(9) + '  ผล',
  );
  log('─'.repeat(width + 38));

  for (const r of results) {
    const mark = r.failed ? `✗ status ${r.status}` : r.over ? '✗ เกินงบ' : 'ok';
    log(
      r.route.path.padEnd(width) +
        `${r.ms.toFixed(0)} ms`.padStart(9) +
        `${r.route.budgetMs}`.padStart(8) +
        `${(r.bytes / 1024).toFixed(0)} KB`.padStart(9) +
        `  ${mark}`,
    );
  }

  const problems = results.filter((r) => r.over || r.failed);
  log('');

  if (problems.length === 0) {
    log(`✓ ${results.length} เส้นทาง อยู่ในงบทั้งหมด`);
    return 0;
  }

  log(`✗ ${problems.length} เส้นทางมีปัญหา:`);
  for (const r of problems) {
    const why = r.failed
      ? `ตอบ status ${r.status} (ยิงไม่สำเร็จ — ผลเวลาเชื่อไม่ได้)`
      : `${r.ms.toFixed(0)}ms เกินงบ ${r.route.budgetMs}ms`;
    log(`  · ${r.route.path}\n      ${why}${r.route.note ? `\n      บริบท: ${r.route.note}` : ''}`);
  }
  log('');
  log('ไล่หาสาเหตุต่อได้ด้วย --keep แล้วเปิด EXPLAIN (ANALYZE, BUFFERS) กับคิวรีที่สงสัย');
  return 1;
}

async function main() {
  let exitCode = 1;

  try {
    if (!REUSE) {
      createScratchDatabase();
      runMigrations();
      loadVolume();
    } else {
      log(`• ใช้ฐานข้อมูล ${SCRATCH_DB} ที่มีอยู่แล้ว (--reuse)`);
    }

    await startBackend();
    const results = await measure();
    exitCode = report(results);
  } catch (error) {
    log(`\n✗ ตรวจไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stopBackend();

    if (KEEP || REUSE) {
      log(`\nฐานข้อมูล ${SCRATCH_DB} ถูกเก็บไว้ — ลบเองด้วย DROP DATABASE "${SCRATCH_DB}";`);
    } else {
      try {
        psql(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE);`, { db: 'postgres' });
        log(`\nลบฐานข้อมูล ${SCRATCH_DB} แล้ว`);
      } catch (error) {
        log(`\n⚠ ลบ ${SCRATCH_DB} ไม่สำเร็จ: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  process.exit(exitCode);
}

await main();
