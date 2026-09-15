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
export async function apiFetch<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const { json, timeoutMs = 15_000, headers, signal, ...rest } = options;

  const url = path.startsWith("http")
    ? path
    : `${publicEnv.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;

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

    // network error / backend ไม่ได้เปิด
    throw new ApiClientError(
      0,
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า backend ทำงานอยู่",
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}
