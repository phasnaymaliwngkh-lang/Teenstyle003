import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import { getPathname, getSearchParams, resetNextMocks, routerMock } from "./helpers/next-mocks.ts";

/**
 * สภาพแวดล้อมสำหรับเทสต์คอมโพเนนต์ (STEP 37)
 *
 * คอมโพเนนต์ในโปรเจกต์นี้พึ่ง 3 อย่างของ Next ที่ไม่มีอยู่นอก Next runtime
 * จึงต้องปลอมให้ครบ ไม่งั้น import เข้ามาก็ล้มก่อนถึงบรรทัดแรกของเทสต์
 *
 * ⚠️ ปลอมเฉพาะ **เปลือกของ Next** เท่านั้น — ตรรกะของเราไม่ปลอมสักตัว
 *    service ที่เรียก API ถูก mock ในไฟล์เทสต์แต่ละไฟล์เอง เพื่อให้เห็นชัดว่า
 *    เทสต์นั้นสมมติอะไรไว้ (mock ที่ซ่อนใน setup กลางคือที่มาของเทสต์ที่ผ่านแบบหลอก ๆ)
 */

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => getPathname(),
  useSearchParams: () => getSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/**
 * `next/link` ต้องมี AppRouterContext ของ Next จริง ๆ จึงเรนเดอร์นอก Next ไม่ได้
 * แทนด้วย `<a>` ธรรมดา — เทสต์สนใจแค่ว่า **ปลายทางถูกต้องไหม** (`href`)
 * ซึ่งเป็นสิ่งที่พลาดบ่อย (กฎ STEP 24 ข้อ 10: ห้ามสร้างลิงก์ที่พาไป 404)
 */
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string | { pathname: string };
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : href.pathname} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * `next/image` ต้องมี config ของ Next (remotePatterns, loader) — แทนด้วย `<img>`
 * และ **ตัด prop ที่เป็นของ Next ออก** ไม่งั้น React เตือนเรื่อง attribute ที่ DOM ไม่รู้จัก
 * แล้ว console เต็มไปด้วย noise จนเทสต์ที่ล้มจริงหาไม่เจอ
 */
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string | { src: string };
    alt: string;
    className?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- ตัวปลอมของ next/image ในเทสต์
    <img src={typeof src === "string" ? src : src.src} alt={alt} className={className} />
  ),
}));

beforeEach(() => {
  resetNextMocks();
});

afterEach(() => {
  cleanup();
});
