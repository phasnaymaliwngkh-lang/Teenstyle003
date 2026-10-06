/**
 * รายการหน้าทั้งหมดของแอป + การเตรียมข้อมูลจริงเพื่อเปิดหน้าเหล่านั้น
 * (แยกออกจาก audit-responsive.mjs ตอน STEP 39)
 *
 * ⚠️ **นี่คือแหล่งความจริงเดียวของ "แอปมีหน้าอะไรบ้าง"**
 *    `frontend/tests/responsive.test.ts` เทียบทุก `page.tsx` กับ `ROUTES` ในไฟล์นี้
 *    เพิ่มหน้าใหม่แล้วไม่เพิ่มที่นี่ → เทสต์ล้ม (กฎ STEP 31 ข้อ 9)
 *    ถ้าก๊อป ROUTES ไปไว้ในสคริปต์อื่น เทสต์จะเฝ้าแค่ก๊อปเดียวแล้วอีกตัวเพี้ยนเงียบ ๆ
 *
 * ใช้โดย: `audit-responsive.mjs` (เลย์เอาต์) · `audit-chrome.mjs` (พฤติกรรมจริงในเบราว์เซอร์)
 */

import { randomBytes } from 'node:crypto';

import { log } from './chrome.mjs';

/**
 * เส้นทางทั้งหมดที่ต้องตรวจ
 *
 * `as` = ล็อกอินเป็นใคร (guest / customer / admin) · `{...}` ถูกแทนด้วยค่าจริงจากฐานข้อมูล
 * เพิ่มหน้าใหม่แล้วต้องมาเพิ่มที่นี่ ไม่งั้นหน้านั้นไม่เคยถูกตรวจ
 */
export const ROUTES = [
  { path: '/', as: 'guest' },
  { path: '/shop', as: 'guest' },
  { path: '/shop?category={categorySlug}&sort=price-asc&page=1', as: 'guest' },
  { path: '/product/{productSlug}', as: 'guest' },
  { path: '/looks', as: 'guest' },
  { path: '/looks/{lookSlug}', as: 'guest' },
  { path: '/faq', as: 'guest' },
  { path: '/customer-service', as: 'guest' },
  { path: '/ai-stylist', as: 'guest' },
  { path: '/about', as: 'guest' },
  { path: '/search', as: 'guest' },
  { path: '/signin', as: 'guest' },
  { path: '/unauthorized', as: 'guest' },
  { path: '/forbidden', as: 'guest' },
  /**
   * `expectStatus` = status ที่เอกสารหลักของหน้านั้น **ต้อง** ตอบ (ไม่ใส่ = 200)
   * กฎ STEP 6: หน้าที่ไม่มีจริงต้องตอบ 404 ไม่ใช่ 200 + หน้า not-found (soft 404)
   * ซึ่ง `loading.tsx` หรือ `<Suspense>` ที่ระดับ page ทำให้เพี้ยนได้โดยไม่มีอะไรฟ้อง
   */
  { path: '/ไม่มีหน้านี้จริง', as: 'guest', note: 'หน้า 404 ที่ราก', expectStatus: 404 },

  { path: '/account', as: 'customer' },
  { path: '/account/profile', as: 'customer' },
  { path: '/account/addresses', as: 'customer' },
  { path: '/account/orders', as: 'customer' },
  { path: '/account/orders/{orderNumber}', as: 'customer' },
  { path: '/account/orders/{orderNumber}/return', as: 'customer' },
  { path: '/account/reviews', as: 'customer' },
  { path: '/account/notifications', as: 'customer' },
  { path: '/account/points', as: 'customer' },
  { path: '/account/returns', as: 'customer' },
  { path: '/wishlist', as: 'customer' },
  { path: '/cart', as: 'customer', note: 'ตะกร้าที่มีของจริง — แถวสินค้าคือจุดที่แน่นที่สุด' },
  { path: '/checkout', as: 'customer' },
  { path: '/checkout/success?order={ownOrderNumber}', as: 'customer' },

  { path: '/admin', as: 'admin' },
  { path: '/admin/orders', as: 'admin' },
  { path: '/admin/orders/{orderNumber}', as: 'admin' },
  { path: '/admin/products', as: 'admin' },
  { path: '/admin/products/new', as: 'admin' },
  { path: '/admin/products/{productId}', as: 'admin' },
  { path: '/admin/inventory', as: 'admin' },
  { path: '/admin/inventory/movements', as: 'admin' },
  { path: '/admin/inventory/{variantId}', as: 'admin' },
  { path: '/admin/alerts', as: 'admin' },
  { path: '/admin/barcodes', as: 'admin' },
  { path: '/admin/barcodes?code={sku}', as: 'admin' },
  { path: '/admin/barcodes/labels?variantId={variantId}', as: 'admin' },
  { path: '/admin/import-export', as: 'admin' },
  { path: '/admin/coupons', as: 'admin' },
  { path: '/admin/returns', as: 'admin' },
  { path: '/admin/returns/{returnId}', as: 'admin' },
  { path: '/admin/reviews', as: 'admin' },
  { path: '/admin/customers', as: 'admin' },
  { path: '/admin/customers/{customerId}', as: 'admin' },
  { path: '/admin/analytics', as: 'admin' },
  { path: '/admin/logs', as: 'admin' },
  { path: '/admin/knowledge', as: 'admin' },
  { path: '/admin/support', as: 'admin' },
];

/** สร้าง session ชั่วคราวให้ผู้ใช้ที่มีบทบาทตามต้องการ แล้วคืน token */
async function createSession(prisma, where, label, createdSessions, prefix) {
  const user = await prisma.user.findFirst({
    where,
    select: { id: true, email: true, role: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!user) throw new Error(`ไม่พบผู้ใช้สำหรับ ${label} ในฐานข้อมูล (ลอง npm run db:seed)`);

  const sessionToken = `${prefix}-${randomBytes(24).toString('hex')}`;

  /*
   * จดไว้ "ก่อน" สร้าง เพื่อให้บล็อก finally ลบได้แม้ขั้นถัดไปจะโยน error
   * (เจอจริง: การหาลูกค้าไม่สำเร็จทำให้ session ของ admin ที่สร้างไปแล้วค้างอยู่ในฐานข้อมูล)
   */
  createdSessions.push(sessionToken);
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 2 * 60 * 60 * 1000) },
  });

  log(`  ${label}: ${user.email} (${user.role.name})`);

  return { sessionToken, userId: user.id, email: user.email };
}

/** ดึงค่าจริงมาแทน {placeholder} ในรายการเส้นทาง */
async function resolvePlaceholders(prisma, apiBase, adminToken) {
  const asAdmin = async (pathname) => {
    const res = await fetch(`${apiBase}${pathname}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    if (!res.ok) throw new Error(`เรียก ${pathname} ไม่สำเร็จ (${res.status})`);

    const body = await res.json();

    return body.data;
  };

  /**
   * ⚠️ รายการของหลังบ้านทุกเส้นคืน `items` (ไม่ใช่ `products` / `orders` / `customers`)
   *    เดิมอ่านชื่อผิด → ค่าว่างเสมอ → หน้ารายละเอียดสินค้า/คำสั่งซื้อ/ลูกค้าในหลังบ้าน
   *    ถูกข้ามทุกรอบโดยไม่มีใครรู้ (แก้ตอน STEP 42 เพราะต้องตรวจหน้าลูกค้าที่เพิ่มแต้มเข้าไป)
   */
  const [product] = (await asAdmin('/api/admin/products?limit=1')).items ?? [];
  const [inventory] = (await asAdmin('/api/admin/inventory?limit=1')).items ?? [];
  const [order] = (await asAdmin('/api/admin/orders?limit=1')).items ?? [];
  const [customer] = (await asAdmin('/api/admin/customers?limit=1&role=CUSTOMER')).items ?? [];
  const [returnRequest] = (await asAdmin('/api/admin/returns?limit=1')).items ?? [];

  const publicProduct = await prisma.product.findFirst({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { slug: true, category: { select: { slug: true } } },
  });
  const look = await prisma.look.findFirst({ where: { isActive: true }, select: { slug: true } });

  return {
    productSlug: publicProduct?.slug ?? '',
    categorySlug: publicProduct?.category?.slug ?? '',
    lookSlug: look?.slug ?? '',
    productId: product?.id ?? '',
    variantId: inventory?.variantId ?? '',
    sku: inventory?.sku ?? '',
    orderNumber: order?.orderNumber ?? '',
    customerId: customer?.id ?? '',
    returnId: returnRequest?.id ?? '',
  };
}

/** คำสั่งซื้อของลูกค้าที่ใช้ทดสอบ — /account/orders/[orderNumber] ต้องเป็นของเขาเอง */
async function customerOrderNumber(prisma, userId) {
  const order = await prisma.order.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { orderNumber: true },
  });

  return order?.orderNumber ?? '';
}

/**
 * เตรียมทุกอย่างที่ต้องใช้เปิดหน้าจริง: session ตามบทบาท + แทนค่า {placeholder}
 *
 * ⚠️ **ผู้เรียกต้องส่ง `createdSessions` เข้ามา** แล้วลบใน `finally` ของตัวเอง
 *    ห้ามรับค่าที่ return แล้วเพิ่งเก็บไว้ลบ เพราะถ้าฟังก์ชันนี้ `throw` กลางทาง
 *    (เช่น หาบัญชีลูกค้าไม่เจอ) ตัวแปรของผู้เรียกจะยังว่าง แล้ว session ของ admin
 *    ที่สร้างไปก่อนหน้าจะค้างในฐานข้อมูล = ใครถือ token นั้นก็เป็น SUPER_ADMIN ได้ 2 ชั่วโมง
 *    (เจอค้างจริง 1 แถวตอนตรวจรอบสุดท้ายของ STEP 40)
 */
export async function prepareRoutes({
  prisma,
  apiBase,
  only = '',
  tokenPrefix,
  createdSessions = [],
}) {
  log('สร้าง session ชั่วคราว…');

  const admin = await createSession(
    prisma,
    { role: { name: { in: ['SUPER_ADMIN', 'ADMIN'] } }, status: 'ACTIVE' },
    'admin',
    createdSessions,
    tokenPrefix,
  );

  /**
   * เลือกลูกค้าที่ "มีคำสั่งซื้อจริง" ก่อน เพราะหน้าที่ว่างเปล่าตรวจอะไรได้น้อยกว่าหน้าที่มีข้อมูล
   *
   * ⚠️ ไม่มีบัญชีลูกค้าเลยต้อง **ข้ามหน้าของลูกค้าแล้วบอกให้เห็น** ไม่ใช่ล้มทั้งสคริปต์
   *    (เจอตอน STEP 39: ฐานข้อมูล dev เหลือผู้ใช้คนเดียวคือ admin แล้วตัวตรวจตายก่อน
   *     ถึงหน้า guest ด้วย — ทั้งที่หน้า guest ตรวจได้ปกติ)
   *    การล้มทั้งตัวทำให้ "ตรวจไม่ได้เลย" ซึ่งแย่กว่า "ตรวจได้บางส่วนแล้วรู้ว่าขาดอะไร"
   */
  const customer =
    (await createSession(
      prisma,
      { role: { name: 'CUSTOMER' }, status: 'ACTIVE', orders: { some: {} } },
      'customer',
      createdSessions,
      tokenPrefix,
    ).catch(() => null)) ??
    (await createSession(
      prisma,
      { role: { name: 'CUSTOMER' }, status: 'ACTIVE' },
      'customer',
      createdSessions,
      tokenPrefix,
    ).catch(() => null));

  const missingRoles = customer === null ? ['customer'] : [];

  if (customer === null) {
    log(
      '\n⚠️ ไม่มีบัญชีลูกค้า (role CUSTOMER สถานะ ACTIVE) ในฐานข้อมูล' +
        ' → ข้ามหน้าของลูกค้าทั้งหมด · หน้าเหล่านั้นยังไม่ถูกตรวจ',
    );
  }

  const placeholders = await resolvePlaceholders(prisma, apiBase, admin.sessionToken);
  const ownOrder = customer === null ? '' : await customerOrderNumber(prisma, customer.userId);

  const resolved = ROUTES.map((route) => {
    const values = { ...placeholders, ownOrderNumber: ownOrder };

    // หน้าในบัญชีต้องใช้ออเดอร์ของลูกค้าคนนั้นเอง ไม่ใช่ใบแรกของร้าน (ของคนอื่นได้ 404 ตามกฎ STEP 10)
    if (route.as === 'customer' && ownOrder) values.orderNumber = ownOrder;

    // ค่าที่หาไม่ได้ให้คง {…} ไว้ เพื่อให้ตัวกรองข้างล่างตัดเส้นทางนั้นออกอย่างเห็นได้ชัด
    return {
      ...route,
      url: route.path.replace(/\{(\w+)\}/g, (match, key) => values[key] || match),
    };
  });

  // เส้นทางที่ข้ามต้อง "เห็น" ไม่ใช่หายเงียบ ๆ ไม่งั้นฐานข้อมูลว่างจะทำให้ขอบเขตการตรวจแคบลงโดยไม่มีใครรู้
  const skipped = resolved.filter((route) => route.url.includes('{'));

  if (skipped.length) {
    log('\n⚠️ ข้ามเพราะไม่มีข้อมูลในฐานข้อมูล (หน้าเหล่านี้ยังไม่ถูกตรวจ):');
    for (const route of skipped) log(`  - ${route.path}`);
  }

  const routes = resolved.filter(
    (route) =>
      !route.url.includes('{') &&
      !missingRoles.includes(route.as) &&
      (!only || route.url.startsWith(only)),
  );

  return {
    routes,
    skipped: [...skipped, ...resolved.filter((route) => missingRoles.includes(route.as))],
    missingRoles,
    createdSessions,
    tokens: { guest: null, customer: customer?.sessionToken ?? null, admin: admin.sessionToken },
  };
}
