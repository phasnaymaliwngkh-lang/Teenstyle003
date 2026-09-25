import type { Application, Router } from 'express';

import { middlewareDescriptorOf } from '../middlewares/describe.ts';

/**
 * แผนผัง REST API ที่อ่านจาก Express router จริง (STEP 29)
 *
 * ทำไมไม่เขียนรายการ endpoint ด้วยมือ
 *   รายการที่เขียนด้วยมือจะเพี้ยนในวันที่ใครเพิ่ม ย้าย หรือลบ route แล้วลืมแก้รายการ
 *   และ **ความเพี้ยนนั้นเงียบ** — ไม่มีอะไรฟ้อง คนอ่านเอกสารจะเชื่อว่า "เส้นทางนี้ไม่ต้องมีสิทธิ์"
 *   หรือเรียกเส้นทางที่ไม่มีจริงแล้วได้ 404 (ปัญหาชนิดเดียวกับ `targetType` สองแบบของ STEP 27
 *   และรายการเมนูที่ลิงก์ไปหน้าที่ยังไม่มีของ STEP 4)
 *   ที่นี่จึงเดินบน `app.router` ของจริง แล้วอ่านด่านจากป้ายที่ติดไว้กับ middleware
 *
 * ข้อจำกัดของ Express ที่ต้องรู้: Layer ไม่เก็บ path ที่ใช้ mount ไว้ (`layer.path` เป็น undefined
 * จนกว่าจะมีคำขอมาตรงกับมัน) จึงต้อง mount router ลูกผ่าน `mountRouter()` เพื่อจำ prefix ไว้เอง
 * — ถ้าใครเรียก `parent.use('/x', child)` ตรง ๆ ตัวเดินแผนผังจะ **โยน error** ไม่ใช่ข้ามไปเงียบ ๆ
 */

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** ต้องล็อกอินไหม — `optional` = แนบผู้ใช้ให้ถ้ามี session แต่ guest ก็เรียกได้ */
export type ApiRouteAuth = 'public' | 'optional' | 'required';

export type ApiRoute = {
  method: Uppercase<HttpMethod>;
  /** path เต็มรวม prefix ทุกชั้น เช่น `/api/admin/products/:productId` */
  path: string;
  auth: ApiRouteAuth;
  /** บทบาทที่อนุญาต — ว่าง = ไม่จำกัดบทบาท */
  roles: string[];
  /** สิทธิ์ที่ต้องมีครบทุกตัว */
  permissions: string[];
  /** ผ่าน `verifyOrigin` แล้วหรือยัง */
  csrf: boolean;
  rateLimit: 'global' | 'strict';
  /** ชื่อ field ของไฟล์ที่อัปโหลดได้ — null = ไม่รับไฟล์ */
  upload: string | null;
  /** เมธอดนี้เปลี่ยนข้อมูลหรือไม่ (ใช้ตรวจว่าต้องมีด่าน CSRF) */
  mutating: boolean;
};

/** route ที่ Express ไม่มีทางเรียกถึง เพราะมี route ที่จับ path เดียวกันอยู่ก่อนแล้ว */
export type UnreachableRoute = {
  method: string;
  path: string;
  /** route ที่จับ path นี้ไปก่อน */
  shadowedBy: string;
};

export type ApiMap = {
  routes: ApiRoute[];
  unreachable: UnreachableRoute[];
};

const MUTATING_METHODS = new Set<HttpMethod>(['post', 'put', 'patch', 'delete']);

/**
 * prefix ของ router ลูกแต่ละตัว
 *
 * ใช้ WeakMap เพื่อไม่ต้องแตะตัว Express Router และไม่กัน router ไม่ให้ถูกเก็บกวาด
 */
const MOUNT_PATHS = new WeakMap<object, string>();

/**
 * mount router ลูกเข้ากับ router พ่อ พร้อมจำ prefix ไว้ให้ `buildApiMap()` อ่านได้
 *
 * ⚠️ **ทุกการ mount router ต้องผ่านฟังก์ชันนี้** ไม่ใช่ `parent.use(path, child)`
 *    ไม่งั้นแผนผังจะไม่รู้ prefix แล้ว endpoint ทั้งกลุ่มจะหายจากเอกสารเงียบ ๆ
 *    (`buildApiMap()` โยน error เมื่อเจอ router ที่ไม่ได้ลงทะเบียน จึงพลาดแล้วเทสต์ล้มทันที)
 */
export function mountRouter(parent: Router, path: string, child: Router): void {
  MOUNT_PATHS.set(child, path);
  parent.use(path, child);
}

type RouteLike = {
  path: string;
  stack: { method?: string; handle: unknown }[];
};

type LayerLike = {
  name: string;
  /** true เมื่อ mount ไว้ที่ '/' (ไม่มี prefix) */
  slash?: boolean;
  handle: unknown;
  route?: RouteLike;
  matchers?: ((path: string) => unknown)[];
};

type RouterHandle = { stack: LayerLike[] };

function asRouterHandle(handle: unknown): RouterHandle | null {
  if (typeof handle !== 'function') return null;
  const stack = (handle as { stack?: unknown }).stack;
  return Array.isArray(stack) ? { stack: stack as LayerLike[] } : null;
}

function joinPaths(prefix: string, suffix: string): string {
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = suffix === '/' ? '' : suffix;
  const joined = `${left}${right}`;
  return joined === '' ? '/' : joined;
}

/** ด่านที่สืบทอดมาจาก router ชั้นนอก */
type Guards = {
  auth: ApiRouteAuth;
  roles: string[];
  permissions: string[];
  csrf: boolean;
  rateLimit: 'global' | 'strict';
  upload: string | null;
};

const NO_GUARDS: Guards = {
  auth: 'public',
  roles: [],
  permissions: [],
  csrf: false,
  rateLimit: 'global',
  upload: null,
};

function nextAuth(current: ApiRouteAuth, incoming: ApiRouteAuth | undefined): ApiRouteAuth {
  // `required` ชนะ `optional` เสมอ — ด่านที่เข้มกว่าคือด่านที่มีผลจริง
  if (incoming === 'required') return 'required';
  if (incoming === 'optional' && current === 'public') return 'optional';
  return current;
}

function applyHandler(guards: Guards, handler: unknown): Guards {
  const descriptor = middlewareDescriptorOf(handler);
  if (!descriptor) return guards;

  return {
    auth: nextAuth(guards.auth, descriptor.auth),
    roles: descriptor.roles ? [...guards.roles, ...descriptor.roles] : guards.roles,
    permissions: descriptor.permissions
      ? [...guards.permissions, ...descriptor.permissions]
      : guards.permissions,
    csrf: guards.csrf || descriptor.csrf === true,
    rateLimit: descriptor.rateLimit ?? guards.rateLimit,
    upload: descriptor.upload ?? guards.upload,
  };
}

function isLiteralPath(path: string): boolean {
  return !path.includes(':') && !path.includes('*') && !path.includes('(');
}

/** route ที่จับ path ไปแล้วในชั้นนี้ ใช้ตรวจว่า route ที่มาทีหลังยังเรียกถึงได้ */
type Claim = {
  methods: Set<string>;
  label: string;
  matches: (path: string) => boolean;
};

/**
 * ตรวจว่า path ที่กำลังจะลงทะเบียนถูก route ที่มาก่อนจับไปแล้วหรือยัง
 *
 * `methods === null` หมายถึงเป็นการ mount router ลูก (ทุกเมธอด)
 * เทียบด้วย path **ของชั้นนี้** เพราะ matcher ของ Express ก็ทำงานกับ path ที่ตัดคำนำหน้าแล้ว
 */
function reportIfShadowed(
  claims: readonly Claim[],
  methods: Set<string> | null,
  fullPath: string,
  relativePath: string,
  map: ApiMap,
): void {
  if (!isLiteralPath(relativePath)) return;

  for (const claim of claims) {
    const methodOverlaps =
      methods === null || [...methods].some((method) => claim.methods.has(method));

    if (!methodOverlaps) continue;
    if (!claim.matches(relativePath)) continue;

    map.unreachable.push({
      method: methods === null ? 'ALL' : [...methods].map((m) => m.toUpperCase()).join('/'),
      path: fullPath,
      shadowedBy: claim.label,
    });
    return;
  }
}

function walk(handle: RouterHandle, prefix: string, inherited: Guards, map: ApiMap): void {
  let guards = inherited;
  const claims: Claim[] = [];

  for (const layer of handle.stack) {
    const route = layer.route;

    if (route) {
      const fullPath = joinPaths(prefix, route.path);
      const methods = new Set(
        route.stack
          .map((entry) => entry.method?.toLowerCase())
          .filter((method): method is HttpMethod => HTTP_METHODS.includes(method as HttpMethod)),
      );

      reportIfShadowed(claims, methods, fullPath, route.path, map);

      for (const method of methods) {
        const own = route.stack
          .filter((entry) => entry.method?.toLowerCase() === method)
          .reduce<Guards>((acc, entry) => applyHandler(acc, entry.handle), guards);

        map.routes.push({
          method: method.toUpperCase() as Uppercase<HttpMethod>,
          path: fullPath,
          auth: own.auth,
          roles: [...new Set(own.roles)],
          permissions: [...new Set(own.permissions)],
          csrf: own.csrf,
          rateLimit: own.rateLimit,
          upload: own.upload,
          mutating: MUTATING_METHODS.has(method),
        });
      }

      const matchers = layer.matchers ?? [];
      claims.push({
        methods,
        label: `${[...methods].map((m) => m.toUpperCase()).join('/')} ${fullPath}`,
        matches: (candidate) => matchers.some((match) => match(candidate) !== false),
      });
      continue;
    }

    const child = asRouterHandle(layer.handle);

    if (child) {
      const mountPath = MOUNT_PATHS.get(layer.handle as object);

      if (mountPath === undefined && layer.slash !== true) {
        throw new Error(
          'พบ router ที่ mount ไว้โดยไม่ผ่าน mountRouter() — endpoint ทั้งกลุ่มจะหายจากแผนผัง API (ดู models/api-map.ts)',
        );
      }

      const childPrefix = mountPath === undefined ? prefix : joinPaths(prefix, mountPath);
      reportIfShadowed(claims, null, childPrefix, mountPath ?? '/', map);
      walk(child, childPrefix, guards, map);
      continue;
    }

    /**
     * middleware ธรรมดา — มีผลกับ route ที่ลงทะเบียน **หลังจากนี้** ในชั้นเดียวกัน
     * (Express เดิน stack ตามลำดับ) จึงสะสมต่อไปตามลำดับที่เจอ
     * ส่วน middleware ที่ผูกกับ path เฉพาะ (เช่น `express.raw` ของ webhook) ไม่ใช่ด่านของทุก route จึงข้าม
     */
    if (layer.slash === true) guards = applyHandler(guards, layer.handle);
  }
}

/**
 * เดินแผนผัง API ทั้งหมดจาก Express app จริง
 *
 * คืนทั้งรายการ endpoint และรายการ route ที่เรียกถึงไม่ได้เพราะถูก route ที่มาก่อนจับไปแล้ว
 * — อย่างหลังคือกับดักที่เจอซ้ำ ๆ ในโปรเจกต์นี้ เช่น `/products/search` ที่เผลอไปอยู่หลัง
 * `/products/:slug` แล้วกลายเป็น "ค้นหาสินค้าที่ slug ชื่อ search" โดยไม่มี error ให้เห็น
 */
export function buildApiMap(app: Application): ApiMap {
  const root = asRouterHandle((app as unknown as { router: unknown }).router);

  if (!root) {
    throw new Error('อ่าน router ของ Express ไม่ได้ — โครงภายในของ Express อาจเปลี่ยนไป');
  }

  const map: ApiMap = { routes: [], unreachable: [] };
  walk(root, '', NO_GUARDS, map);
  return map;
}

/** endpoint ทั้งหมดที่อยู่ใต้ prefix นี้ */
export function routesUnder(routes: readonly ApiRoute[], prefix: string): ApiRoute[] {
  return routes.filter((route) => route.path === prefix || route.path.startsWith(`${prefix}/`));
}

/** เมธอดที่ prefix นี้รองรับ เรียงแบบที่อ่านง่าย (GET ก่อน DELETE) ไม่ใช่เรียงตามตัวอักษร */
export function methodsUnder(routes: readonly ApiRoute[], prefix: string): string[] {
  const used = new Set(routesUnder(routes, prefix).map((route) => route.method));
  return HTTP_METHODS.map((method) => method.toUpperCase()).filter((method) =>
    used.has(method as Uppercase<HttpMethod>),
  );
}
