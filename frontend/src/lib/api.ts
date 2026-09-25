import type { ApiBody } from "@/types/api";

import { publicEnv } from "./env";

/**
 * Error ที่เกิดจากการเรียก REST API
 * เก็บ errorCode จาก backend ไว้ เพื่อให้ UI แสดงข้อความที่ตรงกับสาเหตุได้ (STEP 30)
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(status: number, message: string, errorCode: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.errorCode = errorCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** body แบบ object — จะถูกแปลงเป็น JSON ให้เอง */
  json?: unknown;
  /** timeout หน่วย ms (ค่าเริ่มต้น 15 วินาที) กัน UI ค้างเมื่อ backend ไม่ตอบ */
  timeoutMs?: number;
}

/**
 * fetch wrapper ที่ใช้เรียก backend ทุกครั้ง
 *
 * - แนบ credentials เพื่อให้ cookie session ถูกส่งไปด้วย (STEP 3)
 * - แปลง response ที่ไม่สำเร็จเป็น ApiClientError เสมอ เพื่อให้ทุกหน้าจัด error ได้แบบเดียวกัน
 * - มี timeout กัน request ค้าง
 */
/**
 * ฐานของ URL ที่จะใช้เรียก backend — **ต่างกันระหว่างเบราว์เซอร์กับ server**
 *
 * เบราว์เซอร์: ถ้าตั้ง `NEXT_PUBLIC_API_PROXY_PATH` ไว้ ให้ยิงไปโดเมนตัวเอง
 *   (Next rewrite ต่อไป backend) → cookie เป็น first-party จึงไม่ถูกเบราว์เซอร์บล็อก
 * server: ต้องเป็น URL เต็มเสมอ เพราะ `fetch` ของ Node แปลง path สัมพัทธ์ไม่ได้
 *   (และการยิงตรงจาก server ไป backend เร็วกว่า ไม่ต้องอ้อมผ่าน proxy)
 */
function apiBase(): string {
  if (typeof window !== "undefined" && publicEnv.apiProxyPath !== "") {
    return publicEnv.apiProxyPath;
  }

  return publicEnv.apiUrl;
}

export async function apiFetch<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const { json, timeoutMs = 15_000, headers, signal, ...rest } = options;

  const url = path.startsWith("http")
    ? path
    : `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // ถ้าผู้เรียกส่ง signal มาเอง ให้ยกเลิกพร้อมกันได้
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });

    const text = await response.text();
    let body: ApiBody<TData> | null = null;

    if (text.length > 0) {
      try {
        body = JSON.parse(text) as ApiBody<TData>;
      } catch {
        throw new ApiClientError(
          response.status,
          "รูปแบบข้อมูลที่ได้รับจากเซิร์ฟเวอร์ไม่ถูกต้อง",
          "INVALID_RESPONSE",
        );
      }
    }

    if (body === null) {
      throw new ApiClientError(response.status, "เซิร์ฟเวอร์ไม่ส่งข้อมูลกลับมา", "EMPTY_RESPONSE");
    }

    if (!body.success) {
      throw new ApiClientError(response.status, body.message, body.errorCode, body.details);
    }

    return body.data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError(408, "เชื่อมต่อเซิร์ฟเวอร์ใช้เวลานานเกินไป", "REQUEST_TIMEOUT");
    }

    /**
     * network error / backend ไม่ได้เปิด
     *
     * ⚠️ ข้อความนี้ไปโผล่บนหน้าเว็บจริงผ่าน `errorMessageOf()` ได้ จึงต้องเขียนให้ลูกค้าอ่าน
     *    เดิมเขียนว่า "กรุณาตรวจสอบว่า backend ทำงานอยู่" ซึ่งเป็นคำสั่งถึงนักพัฒนา
     *    ลูกค้าทำตามไม่ได้และไม่ควรต้องรู้ว่าระบบข้างในแบ่งเป็นกี่ส่วน (เจอตอน STEP 30)
     *    ส่วนคำใบ้สำหรับนักพัฒนายังเก็บไว้ตอน dev เพราะตอนนั้นคนอ่านคือเราเอง
     */
    throw new ApiClientError(
      0,
      process.env.NODE_ENV === "development"
        ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (dev: ตรวจสอบว่า backend ทำงานอยู่)"
        : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ข้อความ error ที่อธิบายสาเหตุจริงให้ผู้ใช้ได้
 *
 * ⚠️ `ApiClientError.message` ของข้อผิดพลาดจาก Zod เป็นข้อความรวม
 *    ("ข้อมูลที่ส่งมาไม่ถูกต้อง") ซึ่งไม่บอกว่าต้องแก้อะไร
 *    สาเหตุจริงอยู่ใน `details[].message` เช่น "ดูรายงานได้ครั้งละไม่เกิน 366 วัน"
 *    → หน้าไหนที่ผู้ใช้กรอกค่าเองให้ใช้ฟังก์ชันนี้แทนการอ่าน `.message` ตรง ๆ
 *    (บทเรียนเดียวกับ STEP 15: ข้อความ error ต้องบอกให้ผู้ใช้แก้ถูก)
 */
export function errorMessageOf(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;

  if (Array.isArray(error.details)) {
    const first = error.details.find(
      (item): item is { message: string } =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { message?: unknown }).message === "string",
    );

    if (first) return first.message;
  }

  return error.message;
}
