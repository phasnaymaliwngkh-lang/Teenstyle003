import { Router, type Application } from 'express';

import { API_VERSION } from '../config/index.ts';
import { buildApiMap, methodsUnder, mountRouter, routesUnder } from '../models/api-map.ts';
import { sendSuccess } from '../utils/api-response.ts';

import { adminRouter } from './admin.route.ts';
import { aiRouter } from './ai.route.ts';
import { cartRouter } from './cart.route.ts';
import { categoryRouter, lookRouter, productRouter } from './catalog.route.ts';
import { healthRouter } from './health.route.ts';
import { notificationRouter } from './notification.route.ts';
import { checkoutRouter, orderRouter } from './order.route.ts';
import { paymentRouter } from './payment.route.ts';
import { reviewRouter } from './review.route.ts';
import { userRouter } from './user.route.ts';
import { wishlistRouter } from './wishlist.route.ts';

/**
 * REST API ทั้งหมดของร้าน (STEP 29)
 *
 * ตารางด้านล่างเป็นทั้ง **ตัว mount จริง** และ **คำอธิบายของแต่ละกลุ่ม** ในที่เดียวกัน
 * เพราะเดิมเป็นรายการที่เขียนแยกไว้ต่างหากแล้วเพี้ยนจากความจริงเงียบ ๆ:
 * มันประกาศ `/api/inventory` ว่า "planned" ทั้งที่คลังสินค้าเปิดใช้มาตั้งแต่ STEP 15
 * (อยู่ที่ `/api/admin/inventory`) — คนอ่านจะเรียกเส้นทางที่ไม่มีจริงแล้วได้ 404
 *
 * ตอนนี้จำนวน endpoint และเมธอดของทุกกลุ่ม **อ่านจาก router จริง** ผ่าน `buildApiMap()`
 * เขียนโน้ตให้กลุ่มที่ไม่มีอยู่จริงไม่ได้ (เทสต์จับ) และลืมเขียนโน้ตให้กลุ่มที่มีอยู่ก็ไม่ได้
 */
type ApiGroup = {
  path: string;
  router: Router;
  /** STEP ที่ทำกลุ่มนี้ */
  step: number;
  note: string;
};

const API_GROUPS: readonly ApiGroup[] = [
  {
    path: '/users',
    router: userRouter,
    step: 25,
    note: 'ข้อมูลของผู้ใช้ที่ล็อกอินอยู่ — โปรไฟล์และสมุดที่อยู่ (ต้องล็อกอินทุกเส้นทาง)',
  },
  {
    path: '/products',
    router: productRouter,
    step: 6,
    note: 'แคตตาล็อกสินค้า ค้นหา ตัวกรอง ตรวจสต็อก และรีวิวของสินค้า (เปิดให้ทุกคน)',
  },
  { path: '/categories', router: categoryRouter, step: 6, note: 'หมวดหมู่สินค้าแบบต้นไม้' },
  {
    path: '/looks',
    router: lookRouter,
    step: 7,
    note: 'ลุคแนะนำ พร้อมการตรวจว่าซื้อครบชุดได้จริงหรือไม่',
  },
  {
    path: '/cart',
    router: cartRouter,
    step: 9,
    note: 'ตะกร้าสินค้า — ใช้ได้ทั้งแบบล็อกอินและ guest (cookie `cart-token`)',
  },
  { path: '/checkout', router: checkoutRouter, step: 10, note: 'สรุปยอดก่อนสั่งซื้อ' },
  {
    path: '/orders',
    router: orderRouter,
    step: 12,
    note: 'สร้างคำสั่งซื้อ ประวัติ ติดตามสถานะ ชำระเงิน และยกเลิก',
  },
  {
    path: '/payments',
    router: paymentRouter,
    step: 11,
    note: 'ช่องทางชำระเงินที่เปิดใช้จริง และ webhook ของ Stripe (COD พร้อมใช้ · Stripe รอตั้งค่า key)',
  },
  {
    path: '/reviews',
    router: reviewRouter,
    step: 23,
    note: 'เขียน แก้ ลบรีวิวของตัวเอง และโหวตว่ามีประโยชน์',
  },
  { path: '/wishlist', router: wishlistRouter, step: 22, note: 'รายการที่ถูกใจ (ต้องล็อกอิน)' },
  {
    path: '/notifications',
    router: notificationRouter,
    step: 24,
    note: 'การแจ้งเตือนของตัวเอง — ช่องทาง IN_APP เท่านั้น (อีเมลจริงเป็นงานของ STEP 50)',
  },
  {
    path: '/ai',
    router: aiRouter,
    step: 21,
    note: 'AI Stylist · AI Customer Service · คลังความรู้และ FAQ (guest ใช้ได้)',
  },
  {
    path: '/admin',
    router: adminRouter,
    step: 27,
    note: 'หลังบ้านทั้งหมด — ต้องล็อกอิน เป็นพนักงานขึ้นไป และมีสิทธิ์ตรงกับงานนั้น',
  },
];

/**
 * กลุ่มที่ยังไม่มีจริง — **แยกออกจาก `groups` โดยเจตนา**
 *
 * เดิมปนอยู่ในรายการเดียวกันโดยมีแค่ฟิลด์ `status: 'planned'` กำกับ
 * ซึ่งอ่านผ่าน ๆ แล้วเข้าใจว่าเรียกได้ (กฎเดียวกับ STEP 4 ข้อ 2: ห้ามใส่ลิงก์ไปหน้าที่ยังไม่มี)
 */
const PLANNED_GROUPS = [
  {
    path: '/api/brands',
    step: 48,
    note: 'รายการแบรนด์แยกกลุ่ม — ตอนนี้กรองแบรนด์ผ่าน /api/products ได้แล้ว',
  },
  { path: '/api/shipments', step: 44, note: 'จัดการใบจัดส่งและผู้ให้บริการขนส่ง' },
  { path: '/api/coupons', step: 41, note: 'คูปองและส่วนลด' },
  { path: '/api/returns', step: 43, note: 'คืนสินค้าและคืนเงิน' },
] as const;

/** endpoint ที่เป็นของ Next.js ไม่ใช่ Express — ต้องบอกไว้ ไม่งั้นดูเหมือน API นี้ไม่มีระบบล็อกอิน */
const EXTERNAL_GROUPS = [
  {
    path: '/api/auth/*',
    note: 'Auth.js v5 บน Next.js (Google OAuth + session ในฐานข้อมูล) — ไม่ได้ผ่าน Express',
  },
  {
    path: '/api/cart/merge',
    note: 'Next.js Route Handler ที่เรียก POST /api/cart/merge ของ Express ต่อ แล้วลบ cookie `cart-token` ของเบราว์เซอร์',
  },
] as const;

export const apiRouter = Router();

type ApiIndexGroup = {
  path: string;
  step: number;
  note: string;
  endpoints: number;
  methods: string[];
};

/**
 * แผนผังที่ส่งให้ `GET /api` — คิดครั้งเดียวแล้วเก็บไว้ เพราะ router ไม่เปลี่ยนหลังบูต
 */
let cachedIndex: { groups: ApiIndexGroup[]; endpoints: number } | null = null;

function apiIndex(app: Application): { groups: ApiIndexGroup[]; endpoints: number } {
  if (cachedIndex) return cachedIndex;

  const { routes } = buildApiMap(app);

  cachedIndex = {
    groups: API_GROUPS.map((group) => {
      const prefix = `/api${group.path}`;
      return {
        path: prefix,
        step: group.step,
        note: group.note,
        endpoints: routesUnder(routes, prefix).length,
        methods: methodsUnder(routes, prefix),
      };
    }),
    endpoints: routesUnder(routes, '/api').length,
  };

  return cachedIndex;
}

/** GET /api — สารบัญของ API ที่ตัวเลขทุกตัวมาจาก router จริง */
apiRouter.get('/', (req, res) => {
  const index = apiIndex(req.app);

  sendSuccess(
    res,
    {
      name: 'TEENSTYLE AI REST API',
      version: API_VERSION,
      documentation: 'docs/09-api-reference.md',
      totalEndpoints: index.endpoints,
      groups: index.groups,
      external: EXTERNAL_GROUPS,
      planned: PLANNED_GROUPS,
    },
    'TEENSTYLE AI REST API',
  );
});

for (const group of API_GROUPS) {
  mountRouter(apiRouter, group.path, group.router);
}

export const rootRouter = Router();

mountRouter(rootRouter, '/health', healthRouter);
mountRouter(rootRouter, '/api', apiRouter);

/** ใช้ในเทสต์เพื่อตรวจว่าโน้ตของทุกกลุ่มตรงกับกลุ่มที่ mount ไว้จริง */
export const API_GROUP_PREFIXES: readonly string[] = API_GROUPS.map((group) => `/api${group.path}`);

/** endpoint ที่ประกาศว่า "ยังไม่มี" ต้องไม่มีอยู่จริง — เทสต์ตรวจข้อนี้ */
export const PLANNED_GROUP_PREFIXES: readonly string[] = PLANNED_GROUPS.map((group) => group.path);
