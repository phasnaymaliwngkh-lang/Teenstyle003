/**
 * TEENSTYLE AI — Database Seed (STEP 2)
 *
 * รันด้วย:  npm run db:seed  (จาก root)
 * Prisma เรียกไฟล์นี้ผ่าน `migrations.seed` ใน ../prisma.config.ts
 *
 * คุณสมบัติสำคัญ
 *   - **idempotent**: รันซ้ำได้ไม่สร้างข้อมูลซ้ำ (ใช้ upsert กับคีย์ที่ไม่ซ้ำทุกจุด)
 *   - **stock เข้าระบบผ่าน InventoryMovement เสมอ** ไม่เขียน Inventory.quantity ลอย ๆ
 *     เพื่อให้มี audit trail ตั้งแต่แถวแรก (STEP 15)
 *   - ใช้ transaction ต่อ 1 สินค้า เพื่อให้ product + variant + inventory + movement
 *     + totalStock อยู่ในสถานะที่สอดคล้องกันเสมอ
 *
 * ตั้งค่าเพิ่มเติมได้ด้วย env:
 *   SEED_ADMIN_EMAIL  อีเมลที่จะได้บทบาท SUPER_ADMIN (ควรใส่อีเมล Google ของคุณ
 *                     เพื่อให้ล็อกอินใน STEP 3 แล้วเข้า /admin ได้ทันที)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '.env'), quiet: true });
loadEnv({ path: path.resolve(here, '..', '..', '.env'), quiet: true });

const { getPrisma, disconnectDatabase } = await import('../src/index.ts');
const { BRANDS, CATEGORIES, COLORS, COUPONS, LOOKS, PERMISSIONS, PRODUCTS, ROLES, SIZES } =
  await import('./data.ts');

const prisma = getPrisma();

/** สร้างบาร์โค้ด 13 หลักแบบคงที่จาก SKU เพื่อให้ seed ซ้ำได้ค่าเดิม (STEP 17) */
function barcodeFromSku(sku: string): string {
  let hash = 0;
  for (const char of sku) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_000_00;
  }
  return `88${String(hash).padStart(11, '0')}`.slice(0, 13);
}

function log(step: string, detail: string): void {
  console.log(`  ${step.padEnd(22)} ${detail}`);
}

// ─── 1. Permissions + Roles (STEP 3) ─────────────────────────────────────────

async function seedRbac(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }
  log('permissions', `${PERMISSIONS.length} รายการ`);

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        // ใช้ set เพื่อให้สิทธิ์ตรงกับที่ประกาศไว้เสมอ แม้จะรัน seed ซ้ำหลังแก้รายการสิทธิ์
        permissions: { set: role.permissionKeys.map((key) => ({ key })) },
      },
      create: {
        name: role.name,
        description: role.description,
        permissions: { connect: role.permissionKeys.map((key) => ({ key })) },
      },
    });
  }
  log('roles', ROLES.map((r) => `${r.name}(${r.permissionKeys.length})`).join(' · '));
}

// ─── 2. Size / Color / Category / Brand (STEP 48) ────────────────────────────

async function seedCatalogBasics(): Promise<void> {
  for (const size of SIZES) {
    await prisma.size.upsert({
      where: { code: size.code },
      update: { name: size.name, sortOrder: size.sortOrder, isActive: true },
      create: size,
    });
  }
  log('sizes', `${SIZES.length} ไซซ์`);

  for (const color of COLORS) {
    await prisma.color.upsert({
      where: { slug: color.slug },
      update: { name: color.name, hex: color.hex, sortOrder: color.sortOrder, isActive: true },
      create: color,
    });
  }
  log('colors', `${COLORS.length} สี`);

  // หมวดแม่ต้องมีก่อนหมวดลูก จึงเรียงตาม parentSlug
  const ordered = [...CATEGORIES].sort(
    (a, b) => Number(Boolean(a.parentSlug)) - Number(Boolean(b.parentSlug)),
  );

  for (const category of ordered) {
    const parent = category.parentSlug
      ? await prisma.category.findUnique({ where: { slug: category.parentSlug } })
      : null;

    if (category.parentSlug && !parent) {
      throw new Error(`ไม่พบหมวดแม่ "${category.parentSlug}" ของหมวด "${category.slug}"`);
    }

    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        parentId: parent?.id ?? null,
        isActive: true,
      },
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        sortOrder: category.sortOrder,
        parentId: parent?.id ?? null,
      },
    });
  }
  const parents = CATEGORIES.filter((c) => !c.parentSlug).length;
  log(
    'categories',
    `${CATEGORIES.length} หมวด (แม่ ${parents} · ย่อย ${CATEGORIES.length - parents})`,
  );

  for (const brand of BRANDS) {
    await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: { name: brand.name, description: brand.description, isActive: true },
      create: brand,
    });
  }
  log('brands', BRANDS.map((b) => b.name).join(' · '));
}

// ─── 3. Products + Variants + Inventory + Movement (STEP 6, 15) ──────────────

async function seedProducts(): Promise<{ products: number; variants: number; units: number }> {
  let variantCount = 0;
  let unitCount = 0;

  for (const item of PRODUCTS) {
    const [category, brand] = await Promise.all([
      prisma.category.findUnique({ where: { slug: item.categorySlug } }),
      prisma.brand.findUnique({ where: { slug: item.brandSlug } }),
    ]);

    if (!category) throw new Error(`ไม่พบหมวด "${item.categorySlug}" ของสินค้า ${item.sku}`);
    if (!brand) throw new Error(`ไม่พบแบรนด์ "${item.brandSlug}" ของสินค้า ${item.sku}`);

    const colors = await prisma.color.findMany({ where: { slug: { in: item.colorSlugs } } });
    const sizes = await prisma.size.findMany({ where: { code: { in: item.sizeCodes } } });

    if (colors.length !== item.colorSlugs.length) {
      throw new Error(`สีของสินค้า ${item.sku} ไม่ครบตามที่ระบุ`);
    }
    if (sizes.length !== item.sizeCodes.length) {
      throw new Error(`ไซซ์ของสินค้า ${item.sku} ไม่ครบตามที่ระบุ`);
    }

    const totalStock = colors.length * sizes.length * item.stockPerVariant;

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.upsert({
        where: { sku: item.sku },
        update: {
          name: item.name,
          slug: item.slug,
          description: item.description,
          shortDescription: item.shortDescription,
          price: item.price,
          salePrice: item.salePrice ?? null,
          categoryId: category.id,
          brandId: brand.id,
          status: 'ACTIVE',
          minimumStock: item.minimumStock,
          totalStock,
          tags: item.tags,
          publishedAt: new Date(),
        },
        create: {
          name: item.name,
          slug: item.slug,
          sku: item.sku,
          description: item.description,
          shortDescription: item.shortDescription,
          price: item.price,
          salePrice: item.salePrice ?? null,
          categoryId: category.id,
          brandId: brand.id,
          status: 'ACTIVE',
          minimumStock: item.minimumStock,
          totalStock,
          tags: item.tags,
          publishedAt: new Date(),
        },
      });

      // ProductImage ไม่มี unique key ตามธรรมชาติ จึงลบแล้วสร้างใหม่ให้ผลลัพธ์คงที่
      await tx.productImage.deleteMany({ where: { productId: product.id } });
      await tx.productImage.createMany({
        data: item.images.map((image, index) => ({
          productId: product.id,
          url: image.url,
          alt: image.alt,
          sortOrder: index,
          isMain: index === 0,
        })),
      });

      for (const color of colors) {
        for (const size of sizes) {
          const variantSku = `${item.sku}-${color.slug.toUpperCase().slice(0, 3)}-${size.code}`;

          const variant = await tx.productVariant.upsert({
            where: { sku: variantSku },
            update: {
              productId: product.id,
              colorId: color.id,
              sizeId: size.id,
              isActive: true,
            },
            create: {
              productId: product.id,
              sku: variantSku,
              barcode: barcodeFromSku(variantSku),
              colorId: color.id,
              sizeId: size.id,
            },
          });

          await tx.inventory.upsert({
            where: { variantId: variant.id },
            update: { quantity: item.stockPerVariant },
            create: { variantId: variant.id, quantity: item.stockPerVariant, location: 'MAIN' },
          });

          // stock ต้องเข้าระบบผ่าน movement เพื่อให้ตรวจย้อนหลังได้ (STEP 15)
          // idempotencyKey กันสร้าง movement ซ้ำเมื่อรัน seed อีกครั้ง
          await tx.inventoryMovement.upsert({
            where: { idempotencyKey: `seed:init-stock:${variantSku}` },
            update: {},
            create: {
              variantId: variant.id,
              type: 'STOCK_IN',
              quantity: item.stockPerVariant,
              quantityBefore: 0,
              quantityAfter: item.stockPerVariant,
              reason: 'รับสินค้าเข้าคลังครั้งแรก (seed)',
              referenceType: 'SEED',
              idempotencyKey: `seed:init-stock:${variantSku}`,
            },
          });

          variantCount += 1;
          unitCount += item.stockPerVariant;
        }
      }
    });
  }

  return { products: PRODUCTS.length, variants: variantCount, units: unitCount };
}

// ─── 4. Looks (STEP 7, 8) ────────────────────────────────────────────────────

async function seedLooks(): Promise<number> {
  let itemCount = 0;

  for (const look of LOOKS) {
    const record = await prisma.look.upsert({
      where: { slug: look.slug },
      update: {
        name: look.name,
        description: look.description,
        style: look.style,
        imageUrl: look.imageUrl,
        imageAlt: look.imageAlt,
        isFeatured: look.isFeatured,
        isActive: true,
      },
      create: {
        name: look.name,
        slug: look.slug,
        description: look.description,
        style: look.style,
        imageUrl: look.imageUrl,
        imageAlt: look.imageAlt,
        isFeatured: look.isFeatured,
      },
    });

    for (const [index, productSlug] of look.productSlugs.entries()) {
      const product = await prisma.product.findUnique({ where: { slug: productSlug } });
      if (!product) throw new Error(`ไม่พบสินค้า "${productSlug}" ของลุค ${look.slug}`);

      await prisma.lookItem.upsert({
        where: { lookId_productId: { lookId: record.id, productId: product.id } },
        update: { sortOrder: index },
        create: { lookId: record.id, productId: product.id, sortOrder: index },
      });
      itemCount += 1;
    }
  }

  return itemCount;
}

// ─── 5. Coupons (STEP 41) ────────────────────────────────────────────────────

async function seedCoupons(): Promise<void> {
  const now = new Date();

  for (const coupon of COUPONS) {
    const endsAt = new Date(now.getTime() + coupon.validDays * 24 * 60 * 60 * 1000);

    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {
        name: coupon.name,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        minOrderAmount: coupon.minOrderAmount ?? null,
        maxDiscountAmount: coupon.maxDiscountAmount ?? null,
        usageLimit: coupon.usageLimit ?? null,
        perUserLimit: coupon.perUserLimit ?? null,
        endsAt,
        isActive: true,
      },
      create: {
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        minOrderAmount: coupon.minOrderAmount ?? null,
        maxDiscountAmount: coupon.maxDiscountAmount ?? null,
        usageLimit: coupon.usageLimit ?? null,
        perUserLimit: coupon.perUserLimit ?? null,
        startsAt: now,
        endsAt,
      },
    });
  }
  log('coupons', COUPONS.map((c) => c.code).join(' · '));
}

// ─── 6. ผู้ดูแลระบบคนแรก (STEP 3) ────────────────────────────────────────────

async function seedAdminUser(): Promise<void> {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase();

  if (!email) {
    log('admin user', 'ข้าม — ไม่ได้ตั้ง SEED_ADMIN_EMAIL');
    console.log(
      '     ℹ️  ตั้ง SEED_ADMIN_EMAIL=<อีเมล Google ของคุณ> ใน .env แล้วรัน seed อีกครั้ง',
    );
    console.log('        เพื่อให้บัญชีนั้นได้สิทธิ์ SUPER_ADMIN ตอนล็อกอินใน STEP 3');
    return;
  }

  const superAdmin = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!superAdmin) throw new Error('ไม่พบบทบาท SUPER_ADMIN — seed RBAC ก่อน');

  // ไม่ตั้ง name/image — ปล่อยว่างไว้ให้ Auth.js เติมจากโปรไฟล์ Google ตอนล็อกอินครั้งแรก
  // (ถ้า seed ใส่ชื่อสมมติไว้ ชื่อจริงจะไม่ถูกเติม เพราะเราไม่เขียนทับค่าที่มีอยู่)
  await prisma.user.upsert({
    where: { email },
    update: { roleId: superAdmin.id, status: 'ACTIVE' },
    create: { email, roleId: superAdmin.id },
  });

  log('admin user', `${email} → SUPER_ADMIN`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🌱 TEENSTYLE AI — database seed\n');

  if (!process.env['DATABASE_URL']) {
    console.error('❌ ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env แล้วกรอกค่าก่อน');
    process.exitCode = 1;
    return;
  }

  await seedRbac();
  await seedCatalogBasics();

  const stock = await seedProducts();
  log(
    'products',
    `${stock.products} สินค้า · ${stock.variants} variant · ${stock.units} ชิ้นในคลัง`,
  );

  const lookItems = await seedLooks();
  log('looks', `${LOOKS.length} ลุค · ${lookItems} รายการสินค้าในลุค`);

  await seedCoupons();
  await seedAdminUser();

  console.log('\n✅ seed สำเร็จ\n');
}

try {
  await main();
} catch (error) {
  console.error('\n❌ seed ล้มเหลว:', error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
