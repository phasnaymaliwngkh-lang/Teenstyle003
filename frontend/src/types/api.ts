/**
 * Response shape มาตรฐานของ REST API — ต้องตรงกับ backend/src/utils/api-response.ts
 * ถ้าฝั่ง backend เปลี่ยน shape ต้องแก้ไฟล์นี้ด้วย
 */
export interface ApiSuccessBody<TData> {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  errorCode: string;
  details?: unknown;
}

export type ApiBody<TData> = ApiSuccessBody<TData> | ApiErrorBody;

/** สถานะของ dependency แต่ละตัวจาก GET /health */
export type ServiceState = "ok" | "down" | "not-configured";

export interface ServiceStatus {
  status: ServiceState;
  message?: string;
}

export interface HealthReport {
  name: string;
  status: "ok" | "degraded";
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
    redis: ServiceStatus;
  };
}
