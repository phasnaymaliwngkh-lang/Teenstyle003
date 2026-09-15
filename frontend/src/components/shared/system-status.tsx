"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fetchHealth } from "@/services/health.service";
import type { HealthReport, ServiceState } from "@/types/api";

type Phase = "loading" | "success" | "error";

const SERVICE_LABEL: Record<keyof HealthReport["services"], string> = {
  api: "Backend API",
  database: "PostgreSQL",
  redis: "Redis",
};

const STATE_STYLE: Record<ServiceState, { label: string; className: string }> = {
  ok: { label: "พร้อมใช้งาน", className: "text-success" },
  down: { label: "ใช้งานไม่ได้", className: "text-danger" },
  "not-configured": { label: "ยังไม่ตั้งค่า", className: "text-muted-light" },
};

function StateIcon({ state }: { state: ServiceState }) {
  if (state === "ok") return <CheckCircle2 className="size-5 text-success" aria-hidden />;
  if (state === "down") return <XCircle className="size-5 text-danger" aria-hidden />;
  return <CircleDashed className="size-5 text-muted-light" aria-hidden />;
}

/**
 * แผงตรวจสถานะระบบของ STEP 1
 *
 * มีไว้เพื่อพิสูจน์ว่าเส้นทาง frontend → backend → CORS ทำงานจริง
 * และเป็นตัวอย่างรูปแบบ loading / error / retry ที่ทุกหน้า async ต้องมี (STEP 32)
 */
export function SystemStatus() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<HealthReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  /** ยิง request แล้วอัปเดต state ใน callback — ไม่ setState แบบ synchronous */
  const runFetch = useCallback((signal?: AbortSignal) => {
    fetchHealth(signal)
      .then((data) => {
        if (signal?.aborted) return;
        setReport(data);
        setPhase("success");
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก",
        );
        setPhase("error");
      });
  }, []);

  /** ใช้กับปุ่ม retry — ตรงนี้ setState ได้ เพราะเกิดจาก event ของผู้ใช้ ไม่ใช่ใน effect */
  const retry = useCallback(() => {
    setPhase("loading");
    setErrorMessage("");
    runFetch();
  }, [runFetch]);

  useEffect(() => {
    // state เริ่มต้นเป็น "loading" อยู่แล้ว จึงไม่ต้อง setState ใน effect
    // (กฎ react-hooks/set-state-in-effect ของ Next 16 ห้ามไว้ เพราะทำให้ render ซ้อน)
    const controller = new AbortController();
    runFetch(controller.signal);
    return () => controller.abort();
  }, [runFetch]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      aria-labelledby="system-status-heading"
      className="w-full rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-lift)] sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="system-status-heading" className="text-lg font-extrabold sm:text-xl">
            สถานะระบบ
          </h2>
          <p className="mt-1 text-sm text-muted">
            ตรวจการเชื่อมต่อจริงจาก frontend ไปยัง <code className="text-brand-dark">/health</code>{" "}
            ของ backend
          </p>
        </div>

        <button
          type="button"
          onClick={retry}
          disabled={phase === "loading"}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold text-brand-dark transition hover:border-brand-soft hover:bg-lilac-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", phase === "loading" && "animate-spin")} aria-hidden />
          ตรวจสอบอีกครั้ง
        </button>
      </div>

      <div className="mt-6" aria-live="polite" aria-busy={phase === "loading"}>
        {/* ── Loading state ── */}
        {phase === "loading" && (
          <div className="flex items-center gap-3 rounded-2xl bg-lilac-50 px-4 py-6 text-sm text-muted">
            <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
            กำลังเชื่อมต่อ backend…
          </div>
        )}

        {/* ── Error state + retry ── */}
        {phase === "error" && (
          <div className="rounded-2xl border border-danger/25 bg-danger/5 px-4 py-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold text-danger">เชื่อมต่อ backend ไม่ได้</p>
                <p className="mt-1 text-sm break-words text-ink-soft">{errorMessage}</p>
                <p className="mt-2 text-sm text-muted">
                  เปิด backend ด้วยคำสั่ง <code className="text-brand-dark">npm run dev</code> ที่
                  root ของโปรเจกต์ แล้วกด “ตรวจสอบอีกครั้ง”
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="btn-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
                >
                  <RefreshCw className="size-4" aria-hidden />
                  ลองอีกครั้ง
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Success state ── */}
        {phase === "success" && report && (
          <div>
            <ul className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(SERVICE_LABEL) as Array<keyof HealthReport["services"]>).map((key) => {
                const service = report.services[key];
                const style = STATE_STYLE[service.status];

                return (
                  <li
                    key={key}
                    className="rounded-2xl border border-line bg-lilac-50 p-4 transition hover:border-brand-soft"
                  >
                    <div className="flex items-center gap-2">
                      <StateIcon state={service.status} />
                      <span className="font-semibold">{SERVICE_LABEL[key]}</span>
                    </div>
                    <p className={cn("mt-2 text-sm font-semibold", style.className)}>
                      {style.label}
                    </p>
                    {service.message && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{service.message}</p>
                    )}
                  </li>
                );
              })}
            </ul>

            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-sm text-muted">
              <div className="flex gap-2">
                <dt>เวอร์ชัน API</dt>
                <dd className="font-semibold text-ink">{report.version}</dd>
              </div>
              <div className="flex gap-2">
                <dt>environment</dt>
                <dd className="font-semibold text-ink">{report.environment}</dd>
              </div>
              <div className="flex gap-2">
                <dt>uptime</dt>
                <dd className="font-semibold text-ink">{report.uptimeSeconds} วินาที</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </motion.section>
  );
}
