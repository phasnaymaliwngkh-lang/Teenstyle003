import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของระบบคลังสินค้า (STEP 15)
 *
 * สิ่งที่ต้องพิสูจน์
 *   - RBAC: ลูกค้าเข้าไม่ได้ · สิทธิ์ "ดู" กับ "ปรับ" แยกกัน
 *   - **สต็อกห้ามติดลบ** และ **ห้ามตัดของที่ลูกค้าจองไว้**
 *   - ทุกการเปลี่ยนจำนวนมี InventoryMovement คู่กัน + cache `Product.totalStock` ตรงกับ Inventory
 *   - ปรับยอดตามการตรวจนับคำนวณผลต่างเอง · ยอดเท่าเดิม → ปฏิเสธ (ไม่เขียน movement ขยะ)
 *   - กดปุ่มซ้ำด้วย idempotencyKey เดิม → ไม่มีผล 2 เท่า
 *   - ผลรวมของ movement ต้องอธิบายยอดในคลังได้ (audit trail ใช้งานได้จริง)
 *   - หน้าร้าน: ตัวกรอง "พร้อมส่ง" และสถานะสต็อกคิดจากของที่ขายได้จริง (หนี้จาก STEP 7)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let staff = { id: '', token: '' };
let viewer = { id: '', token: '' };
let customer = { id: '', token: '' };

let productId = '';
let variantId = '';
let variantSku = '';
let productSlug = '';
let productSku = '';
const INITIAL_STOCK = 20;

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-inv-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

function asStaff() {
  return { Authorization: `Bearer ${staff.token}` };
}

/** สินค้าทดสอบของไฟล์นี้เอง — ไม่แตะสต็อกของ seed */
async function createTestProduct() {
  const unique = randomUUID().slice(0, 6);
  const res = await request(app)
    .post('/api/admin/products')
    .set(asStaff())
    .send({
      name: 'สินค้าทดสอบคลัง STEP 15',
      slug: `test-inventory-${unique}`,
      sku: `TS-INV-${unique.toUpperCase()}`,
      description: 'สินค้าทดสอบระบบคลังสินค้าที่มีคำอธิบายยาวพอสำหรับ validation',
      price: 500,
      categorySlug: 'tops',
      status: 'ACTIVE',
      minimumStock: 5,
      images: [
        {
          url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
          alt: 'รูปสินค้าทดสอบ',
          isMain: true,
          sortOrder: 0,
        },
      ],
      variants: [
        {
          sku: `TS-INV-${unique.toUpperCase()}-BLA-M`,
          colorSlug: 'black',
          sizeCode: 'M',
          initialStock: INITIAL_STOCK,
          isActive: true,
        },
      ],
    });

  if (res.status !== 201) {
    throw new Error(`สร้างสินค้าทดสอบไม่สำเร็จ: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    productId: res.body.data.id as string,
    slug: res.body.data.slug as string,
    productSku: res.body.data.sku as string,
    variantId: res.body.data.variants[0].id as string,
    variantSku: res.body.data.variants[0].sku as string,
  };
}

function adjust(body: Record<string, unknown>) {
  return request(app).post(`/api/admin/inventory/${variantId}/adjust`).set(asStaff()).send(body);
}

/** ยอดในคลังจริง + cache ของสินค้า — ใช้ยืนยันว่าสองค่านี้ตรงกันทุกครั้ง */
async function readStock() {
  const [inventory, product] = await Promise.all([
    prisma.inventory.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true, reservedQuantity: true },
    }),
    prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { totalStock: true } }),
  ]);

  return { ...inventory, totalStock: product.totalStock };
}

beforeAll(async () => {
  staff = await createUser('ADMIN', 'staff');
  viewer = await createUser('EMPLOYEE', 'viewer');
  customer = await createUser('CUSTOMER', 'cust');

  const created = await createTestProduct();
  productId = created.productId;
  productSlug = created.slug;
  productSku = created.productSku;
  variantId = created.variantId;
  variantSku = created.variantSku;
});

// คืนสถานะคลังให้เท่าเดิมก่อนทุกเคส เพื่อให้แต่ละเคสอ่านง่ายและไม่ผูกกับลำดับ
beforeEach(async () => {
  await prisma.inventoryMovement.deleteMany({
    where: { variantId, referenceType: 'MANUAL' },
  });
  await prisma.inventory.update({
    where: { variantId },
    data: { quantity: INITIAL_STOCK, reservedQuantity: 0 },
  });
  await prisma.product.update({ where: { id: productId }, data: { totalStock: INITIAL_STOCK } });
});

afterAll(async () => {
  const userIds = [staff.id, viewer.id, customer.id];

  await prisma.inventoryMovement.deleteMany({ where: { variant: { productId } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await disconnectDatabase();
});

describe('RBAC', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้า → 403', async () => {
    const anonymous = await request(app).get('/api/admin/inventory');
    const asShopper = await request(app)
      .get('/api/admin/inventory')
      .set({ Authorization: `Bearer ${customer.token}` });

    expect(anonymous.status).toBe(401);
    expect(asShopper.status).toBe(403);
  });

  it('พนักงานคลัง (EMPLOYEE) ปรับสต็อกได้ตามสิทธิ์ที่ตั้งไว้ในฐานข้อมูล', async () => {
    const res = await request(app)
      .post(`/api/admin/inventory/${variantId}/adjust`)
      .set({ Authorization: `Bearer ${viewer.token}` })
      .send({ type: 'STOCK_IN', quantity: 5, reason: 'พนักงานคลังรับของเข้า' });

    expect(res.status).toBe(200);
    expect((await readStock()).quantity).toBe(INITIAL_STOCK + 5);
  });

  it('ถอนสิทธิ์ inventory:adjust ในฐานข้อมูล → ปรับไม่ได้ทันที (ไม่ได้ hard-code ตามบทบาท)', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'inventory:adjust' },
    });

    try {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });

      const write = await request(app)
        .post(`/api/admin/inventory/${variantId}/adjust`)
        .set({ Authorization: `Bearer ${viewer.token}` })
        .send({ type: 'STOCK_IN', quantity: 5, reason: 'ลองปรับหลังถูกถอนสิทธิ์' });

      const read = await request(app)
        .get('/api/admin/inventory')
        .set({ Authorization: `Bearer ${viewer.token}` });

      expect(write.status).toBe(403);
      // สิทธิ์ "ดู" ยังอยู่ จึงต้องยังเข้าได้ — สองสิทธิ์นี้แยกกันจริง
      expect(read.status).toBe(200);
      expect((await readStock()).quantity).toBe(INITIAL_STOCK);
    } finally {
      // คืนสิทธิ์ให้ฐานข้อมูลเสมอ แม้เทสจะล้ม
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }
  });
});

describe('รับของเข้าคลัง (STOCK_IN)', () => {
  it('รับเข้าแล้วยอดเพิ่ม · มี movement · cache ตรงกับคลัง', async () => {
    const res = await adjust({ type: 'STOCK_IN', quantity: 8, reason: 'รับของจากผู้ผลิต ล็อต A' });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(28);
    expect(res.body.data.inventory.available).toBe(28);

    const stock = await readStock();
    expect(stock.quantity).toBe(28);
    expect(stock.totalStock).toBe(28);

    const movement = res.body.data.movements[0];
    expect(movement.type).toBe('STOCK_IN');
    expect(movement.quantity).toBe(8);
    expect(movement.quantityBefore).toBe(20);
    expect(movement.quantityAfter).toBe(28);
    expect(movement.delta).toBe(8);
    expect(movement.reason).toBe('รับของจากผู้ผลิต ล็อต A');
    expect(movement.actor.id).toBe(staff.id);
  });

  it('ต้องระบุเหตุผล — ไม่ระบุ → 422 พร้อมข้อความภาษาไทย และไม่มีอะไรเปลี่ยน', async () => {
    const noReason = await adjust({ type: 'STOCK_IN', quantity: 5 });
    const tooShort = await adjust({ type: 'STOCK_IN', quantity: 5, reason: 'ก' });

    expect(noReason.status).toBe(422);
    expect(tooShort.status).toBe(422);

    // ข้อความที่ส่งกลับต้องอ่านรู้เรื่อง ไม่ใช่ข้อความดิบของ Zod
    const messages = (noReason.body.details as { message: string }[]).map((d) => d.message);
    expect(messages.join(' ')).toContain('เหตุผล');
    expect(messages.join(' ')).not.toContain('expected string');

    expect((await readStock()).quantity).toBe(INITIAL_STOCK);
  });

  it.each([
    ['จำนวนเป็น 0', { type: 'STOCK_IN', quantity: 0, reason: 'ทดสอบจำนวนศูนย์' }],
    ['จำนวนติดลบ', { type: 'STOCK_IN', quantity: -5, reason: 'ทดสอบจำนวนติดลบ' }],
    ['จำนวนไม่เต็ม', { type: 'STOCK_IN', quantity: 1.5, reason: 'ทดสอบจำนวนทศนิยม' }],
    ['ประเภทที่ไม่รองรับ', { type: 'RETURN', quantity: 5, reason: 'ประเภทที่ไม่ให้ทำมือ' }],
  ])('%s → 422', async (_label, body) => {
    const res = await adjust(body);

    expect(res.status).toBe(422);
  });

  it('ส่ง quantity ตรง ๆ เพื่อเซ็ตยอดไม่ได้ (ไม่มี endpoint ให้เขียนทับ)', async () => {
    const res = await request(app)
      .patch(`/api/admin/inventory/${variantId}`)
      .set(asStaff())
      .send({ quantity: 9999 });

    // ไม่มี route PATCH สำหรับเซ็ตยอด → 404/405 เท่านั้น ห้ามสำเร็จ
    expect(res.status).not.toBe(200);
    expect((await readStock()).quantity).toBe(INITIAL_STOCK);
  });
});

describe('ตัดของออกจากคลัง (STOCK_OUT)', () => {
  it('ตัดออกได้ตามปกติ และบันทึกเหตุผลไว้', async () => {
    const res = await adjust({ type: 'STOCK_OUT', quantity: 3, reason: 'ของชำรุดจากการขนส่ง' });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(17);
    expect(res.body.data.movements[0].type).toBe('STOCK_OUT');
    expect(res.body.data.movements[0].delta).toBe(-3);
    expect((await readStock()).totalStock).toBe(17);
  });

  it('ตัดเกินจำนวนที่มี → 409 และยอดไม่ติดลบ', async () => {
    const res = await adjust({ type: 'STOCK_OUT', quantity: 999, reason: 'ลองตัดเกินจำนวนที่มี' });

    expect(res.status).toBe(409);
    const stock = await readStock();
    expect(stock.quantity).toBe(INITIAL_STOCK);
    expect(stock.totalStock).toBe(INITIAL_STOCK);
  });

  it('ตัดกินของที่ลูกค้าจองไว้ → 409 (ของที่จองแตะไม่ได้)', async () => {
    // จำลองว่ามีออเดอร์จองไว้ 15 จาก 20 → เหลือให้แอดมินตัดได้แค่ 5
    await prisma.inventory.update({ where: { variantId }, data: { reservedQuantity: 15 } });

    const tooMuch = await adjust({
      type: 'STOCK_OUT',
      quantity: 6,
      reason: 'ลองตัดเกินส่วนที่ว่าง',
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.message).toContain('จอง');
    expect((await readStock()).quantity).toBe(INITIAL_STOCK);

    // ตัดเท่าที่ว่างจริงได้
    const justEnough = await adjust({
      type: 'STOCK_OUT',
      quantity: 5,
      reason: 'ตัดเท่าที่ว่างจริง',
    });
    expect(justEnough.status).toBe(200);

    const stock = await readStock();
    expect(stock.quantity).toBe(15);
    expect(stock.quantity).toBeGreaterThanOrEqual(stock.reservedQuantity);
  });
});

describe('ปรับยอดตามการตรวจนับ (ADJUSTMENT)', () => {
  it('นับได้น้อยกว่าระบบ → ลดลงเท่าผลต่าง', async () => {
    const res = await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: 18,
      reason: 'ตรวจนับประจำเดือน พบของหาย 2 ชิ้น',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(18);

    const movement = res.body.data.movements[0];
    expect(movement.type).toBe('ADJUSTMENT');
    expect(movement.quantity).toBe(2); // ฐานข้อมูลบังคับให้เป็นบวก
    expect(movement.delta).toBe(-2); // ทิศทางอ่านจาก before/after
    expect((await readStock()).totalStock).toBe(18);
  });

  it('นับได้มากกว่าระบบ → เพิ่มขึ้นเท่าผลต่าง', async () => {
    const res = await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: 25,
      reason: 'ตรวจนับพบของเกินจากที่บันทึกไว้',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(25);
    expect(res.body.data.movements[0].delta).toBe(5);
  });

  it('นับได้เท่าเดิม → 400 และไม่เขียน movement ขยะ', async () => {
    const before = await prisma.inventoryMovement.count({ where: { variantId } });

    const res = await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: INITIAL_STOCK,
      reason: 'ตรวจนับแล้วตรงกับระบบ',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ตรง');
    expect(await prisma.inventoryMovement.count({ where: { variantId } })).toBe(before);
  });

  it('ปรับให้ต่ำกว่าของที่จองไว้ → 409', async () => {
    await prisma.inventory.update({ where: { variantId }, data: { reservedQuantity: 12 } });

    const res = await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: 3,
      reason: 'ลองปรับต่ำกว่าของที่จองไว้',
    });

    expect(res.status).toBe(409);
    expect((await readStock()).quantity).toBe(INITIAL_STOCK);
  });

  it('ปรับเป็น 0 ได้ถ้าไม่มีใครจอง', async () => {
    const res = await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: 0,
      reason: 'ของหมดจากการตรวจนับจริง',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.inventory.quantity).toBe(0);
    expect(res.body.data.inventory.stockStatus).toBe('OUT_OF_STOCK');
  });
});

describe('กันกดซ้ำ (idempotency)', () => {
  it('ยิงด้วย idempotencyKey เดิม 2 ครั้ง → ยอดเพิ่มครั้งเดียว', async () => {
    const key = randomUUID();
    const body = {
      type: 'STOCK_IN',
      quantity: 10,
      reason: 'รับของเข้า พร้อมกันกดซ้ำ',
      idempotencyKey: key,
    };

    const first = await adjust(body);
    const second = await adjust(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const stock = await readStock();
    expect(stock.quantity).toBe(30);
    expect(stock.totalStock).toBe(30);

    const movements = await prisma.inventoryMovement.count({
      where: { variantId, idempotencyKey: `adjust:${key}` },
    });
    expect(movements).toBe(1);
  });

  it('คีย์ต่างกัน = คนละรายการ → ยอดเพิ่มทั้งสองครั้ง', async () => {
    await adjust({
      type: 'STOCK_IN',
      quantity: 4,
      reason: 'รับของล็อตแรก',
      idempotencyKey: randomUUID(),
    });
    await adjust({
      type: 'STOCK_IN',
      quantity: 6,
      reason: 'รับของล็อตสอง',
      idempotencyKey: randomUUID(),
    });

    expect((await readStock()).quantity).toBe(30);
  });
});

describe('audit trail', () => {
  it('ผลรวมของ movement อธิบายยอดในคลังได้ทั้งหมด', async () => {
    await adjust({ type: 'STOCK_IN', quantity: 10, reason: 'รับเข้าเพื่อทดสอบ audit' });
    await adjust({ type: 'STOCK_OUT', quantity: 4, reason: 'ตัดออกเพื่อทดสอบ audit' });
    await adjust({ type: 'ADJUSTMENT', countedQuantity: 30, reason: 'ปรับยอดเพื่อทดสอบ audit' });

    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'asc' },
      select: { quantityBefore: true, quantityAfter: true },
    });

    // แต่ละแถวต้องต่อกันเป็นลูกโซ่: after ของแถวก่อน = before ของแถวถัดไป
    for (let index = 1; index < movements.length; index += 1) {
      expect(movements[index]!.quantityBefore).toBe(movements[index - 1]!.quantityAfter);
    }

    const stock = await readStock();
    expect(movements.at(-1)!.quantityAfter).toBe(stock.quantity);
    expect(stock.totalStock).toBe(stock.quantity);
  });

  it('ทุกการปรับเขียน AdminLog พร้อมก่อน/หลัง', async () => {
    await adjust({ type: 'STOCK_IN', quantity: 7, reason: 'รับเข้าเพื่อตรวจ AdminLog' });

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { targetType: 'INVENTORY', targetId: variantId },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, action: true, before: true, after: true },
    });

    expect(log.userId).toBe(staff.id);
    expect(log.action).toBe('inventory.stock_in');
    expect(JSON.stringify(log.before)).toContain('20');
    expect(JSON.stringify(log.after)).toContain('รับเข้าเพื่อตรวจ AdminLog');
  });

  it('ประวัติจากการขายของระบบก็อยู่ในรายการเดียวกัน (ไม่ได้มีแค่ที่แอดมินทำ)', async () => {
    const res = await request(app)
      .get(`/api/admin/inventory/movements?variantId=${variantId}`)
      .set(asStaff());

    expect(res.status).toBe(200);
    // ตอนสร้างสินค้ามีการรับเข้าครั้งแรกจากระบบจัดการสินค้า (STEP 14) ติดมาด้วย
    const types = (res.body.data.items as { type: string }[]).map((item) => item.type);
    expect(types).toContain('STOCK_IN');
    expect(res.body.data.total).toBeGreaterThan(0);
  });
});

describe('GET /api/admin/inventory', () => {
  it('สรุปภาพรวมตรงกับผลรวมจริงในฐานข้อมูล', async () => {
    const res = await request(app).get('/api/admin/inventory').set(asStaff());

    expect(res.status).toBe(200);

    const real = await prisma.$queryRaw<
      Array<{ units: bigint; reserved: bigint; available: bigint }>
    >`
      SELECT sum(i."quantity")::bigint AS units,
             sum(i."reservedQuantity")::bigint AS reserved,
             sum(GREATEST(i."quantity" - i."reservedQuantity", 0))::bigint AS available
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      JOIN "Inventory" i ON i."variantId" = v."id"
      WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
    `;

    expect(res.body.data.summary.totalUnits).toBe(Number(real[0]!.units));
    expect(res.body.data.summary.reservedUnits).toBe(Number(real[0]!.reserved));
    expect(res.body.data.summary.availableUnits).toBe(Number(real[0]!.available));
  });

  it('ค้นหาด้วย SKU ของตัวเลือกได้ และค่าที่คืนมาสอดคล้องกัน', async () => {
    const res = await request(app).get(`/api/admin/inventory?q=${variantSku}`).set(asStaff());

    expect(res.body.data.total).toBe(1);

    const row = res.body.data.items[0];
    expect(row.sku).toBe(variantSku);
    expect(row.available).toBe(Math.max(0, row.quantity - row.reserved));
    expect(row.product.id).toBe(productId);
  });

  it('กรองตามสถานะสต็อกแล้วทุกแถวเข้าเงื่อนไขจริง', async () => {
    await adjust({
      type: 'ADJUSTMENT',
      countedQuantity: 0,
      reason: 'ทำให้ของหมดเพื่อทดสอบตัวกรอง',
    });

    const out = await request(app)
      .get('/api/admin/inventory?stockStatus=OUT_OF_STOCK&limit=100')
      .set(asStaff());
    for (const item of out.body.data.items as { available: number }[]) {
      expect(item.available).toBe(0);
    }
    expect(
      (out.body.data.items as { variantId: string }[]).some((i) => i.variantId === variantId),
    ).toBe(true);

    const inStock = await request(app)
      .get('/api/admin/inventory?stockStatus=IN_STOCK&limit=100')
      .set(asStaff());
    for (const item of inStock.body.data.items as { available: number; minimumStock: number }[]) {
      expect(item.available).toBeGreaterThan(item.minimumStock);
    }
  });

  it('variantId ที่ไม่มีจริง → 404 · รูปแบบผิด → 422', async () => {
    const missing = await request(app)
      .get('/api/admin/inventory/00000000-0000-4000-8000-000000000000')
      .set(asStaff());
    const malformed = await request(app).get('/api/admin/inventory/ไม่ใช่-uuid').set(asStaff());

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(422);
  });
});

describe('หน้าร้านต้องเห็นความจริงเดียวกัน (หนี้จาก STEP 7)', () => {
  it('ของถูกจองจนหมด → หน้าร้านบอกว่าหมด และตัวกรองพร้อมส่งไม่คืนสินค้านี้', async () => {
    // ของยังอยู่ในคลัง 20 ชิ้น แต่ถูกจองไว้ทั้งหมด → ซื้อไม่ได้แม้แต่ชิ้นเดียว
    await prisma.inventory.update({
      where: { variantId },
      data: { reservedQuantity: INITIAL_STOCK },
    });

    const detail = await request(app).get(`/api/products/${productSlug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.stockStatus).toBe('OUT_OF_STOCK');

    const inStockOnly = await request(app).get('/api/products/search?inStock=true&limit=48');
    const slugs = (inStockOnly.body.data.items as { slug: string }[]).map((item) => item.slug);
    expect(slugs).not.toContain(productSlug);

    // ไม่กรองก็ต้องเห็น แต่สถานะต้องบอกว่าหมด (ไม่ใช่ซ่อนความจริง)
    // ค้นด้วย SKU ของสินค้า เพราะการค้นหาของหน้าร้านมองที่ชื่อ/SKU/แท็ก ไม่ได้มองที่ slug
    const all = await request(app).get(`/api/products/search?q=${productSku}&limit=10`);
    const found = (all.body.data.items as { slug: string; stockStatus: string }[]).find(
      (item) => item.slug === productSlug,
    );
    expect(found?.stockStatus).toBe('OUT_OF_STOCK');
  });

  it('ยอดในคลังยังอยู่ครบ — การจองไม่ได้ลดของในคลัง', async () => {
    await prisma.inventory.update({ where: { variantId }, data: { reservedQuantity: 8 } });

    const stock = await readStock();
    expect(stock.quantity).toBe(INITIAL_STOCK);
    expect(stock.totalStock).toBe(INITIAL_STOCK);

    const row = await request(app).get(`/api/admin/inventory/${variantId}`).set(asStaff());
    expect(row.body.data.inventory.quantity).toBe(INITIAL_STOCK);
    expect(row.body.data.inventory.reserved).toBe(8);
    expect(row.body.data.inventory.available).toBe(INITIAL_STOCK - 8);
  });
});
