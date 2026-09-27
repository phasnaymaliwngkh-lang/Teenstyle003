import { vi } from "vitest";

/**
 * ตัวปลอมของ `next/navigation` ที่เทสต์อ่านค่าได้ (STEP 37)
 *
 * คอมโพเนนต์เกือบทุกตัวในโปรเจกต์เรียก `router.refresh()` หลังเปลี่ยนข้อมูล
 * เพื่อให้ Server Component อ่านค่าใหม่จาก backend — **นั่นคือพฤติกรรมที่ต้องเทสต์**
 * (ถ้าลืมเรียก หน้าจะยังโชว์ข้อมูลเก่าทั้งที่บันทึกสำเร็จแล้ว)
 * จึงต้องเป็น spy ที่นับครั้งได้ ไม่ใช่ฟังก์ชันเปล่า
 */
export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/";
let searchParams = new URLSearchParams();

export function setPathname(next: string): void {
  pathname = next;
}

export function setSearchParams(next: string): void {
  searchParams = new URLSearchParams(next);
}

export function getPathname(): string {
  return pathname;
}

export function getSearchParams(): URLSearchParams {
  return searchParams;
}

/** เรียกจาก setup ก่อนทุกเทสต์ — ค่าที่ค้างจากเทสต์ก่อนหน้าทำให้ผลเพี้ยนแบบหาสาเหตุยาก */
export function resetNextMocks(): void {
  pathname = "/";
  searchParams = new URLSearchParams();
}
