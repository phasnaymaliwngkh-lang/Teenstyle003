"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  RotateCcw,
  User,
  UserCheck,
} from "lucide-react";

import { escalateCsChat, fetchCsHistory, resetCsChat, sendCsChat } from "@/services/ai.service";
import type { AIConversationStatus, CsMessage } from "@/types/catalog";
import { CsQuickChips } from "./cs-quick-chips";

/** ความถี่ในการดึงข้อความของเจ้าหน้าที่ระหว่างรอ (ms) */
const AGENT_POLL_INTERVAL_MS = 10_000;

export function CsChat() {
  const [messages, setMessages] = useState<CsMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<AIConversationStatus>("ACTIVE");
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [escalating, setEscalating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    /**
     * `behavior: "smooth"` ที่ส่งผ่าน JS **ทับ** `scroll-behavior: auto` ที่ globals.css
     * ตั้งไว้ใน `@media (prefers-reduced-motion: reduce)` จึงต้องเช็คเองตรงนี้
     */
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, status]);

  // โหลดประวัติการสนทนาเมื่อเข้าสู่หน้า
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchCsHistory();
        if (!cancelled) {
          setConversationId(res.conversationId);
          setStatus(res.status);
          setMessages(res.messages);
        }
      } catch {
        if (!cancelled) {
          setError("ไม่สามารถโหลดประวัติการสนทนาได้ กรุณารีเฟรชหน้าเว็บ");
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * ดึงข้อความใหม่ระหว่างที่รอเจ้าหน้าที่คนจริง
   *
   * ⚠️ จำเป็น ไม่ใช่ของแถม: เมื่อบทสนทนาเป็น `ESCALATED` ฝั่ง backend จะตอบกลับเพียง
   *    ข้อความ SYSTEM ว่า "ส่งถึงเจ้าหน้าที่แล้ว" ไม่ได้ส่งประวัติชุดใหม่กลับมา
   *    ถ้าไม่ดึงเอง **คำตอบของเจ้าหน้าที่จะไม่ปรากฏบนหน้าจอลูกค้าเลย** ไม่ว่าลูกค้าจะพิมพ์อีกกี่ครั้ง
   *    จนกว่าจะรีเฟรชหน้า — ซึ่งทำให้ฟีเจอร์ Human Handoff ใช้งานจริงไม่ได้
   *
   * หยุดเองเมื่อเคสถูกปิด และหยุดตอนแท็บถูกซ่อนไว้ เพื่อไม่ยิงทิ้งเปล่า
   */
  useEffect(() => {
    if (status !== "ESCALATED" || !conversationId) return;

    let cancelled = false;

    const pull = async () => {
      if (document.visibilityState === "hidden") return;

      try {
        const res = await fetchCsHistory();
        if (cancelled) return;

        setStatus(res.status);
        setMessages((prev) => {
          // ไม่เขียนทับถ้าไม่มีอะไรใหม่ — กันไม่ให้ React re-render ทุก 10 วินาทีเปล่า ๆ
          const latest = res.messages.at(-1);
          const current = prev.at(-1);
          if (res.messages.length === prev.length && latest?.id === current?.id) return prev;
          return res.messages;
        });
      } catch {
        // เงียบไว้ — การดึงข้อความรอบเดียวล้มเหลวไม่ควรขึ้น error ทับหน้าจอลูกค้า
      }
    };

    const timer = window.setInterval(() => void pull(), AGENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, conversationId]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || loading) return;

    setError(null);
    setInputText("");

    // เพิ่มข้อความของผู้ใช้ทันที (Optimistic UI)
    const tempUserMessage: CsMessage = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: text,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMessage]);
    setLoading(true);

    try {
      const res = await sendCsChat({
        message: text,
        conversationId: conversationId ?? undefined,
      });

      setConversationId(res.conversationId);
      setStatus(res.status);
      setMessages((prev) => [...prev, res.message]);
    } catch {
      /**
       * ⚠️ ต้องถอนข้อความที่ใส่ไว้แบบ optimistic ออก และคืนข้อความกลับเข้าช่องพิมพ์
       *    ถ้าปล่อยค้างไว้ ลูกค้าจะเห็นข้อความของตัวเองอยู่ในแชตเหมือนส่งสำเร็จ
       *    ทั้งที่ backend ไม่เคยได้รับ — แล้วนั่งรอคำตอบที่ไม่มีวันมา
       */
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
      setInputText((current) => (current.trim() ? current : text));
      setError("ไม่สามารถส่งข้อความได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleEscalate = async () => {
    if (!conversationId || escalating || status === "ESCALATED") return;

    setEscalating(true);
    setError(null);

    try {
      await escalateCsChat(conversationId, "ลูกค้าร้องขอผ่านปุ่มติดต่อเจ้าหน้าที่");
      setStatus("ESCALATED");
      const escalateMsg: CsMessage = {
        id: `sys-${Date.now()}`,
        role: "SYSTEM",
        content:
          "ระบบได้ส่งต่อบทสนทนานี้ให้เจ้าหน้าที่ฝ่ายบริการลูกค้าเรียบร้อยแล้ว เจ้าหน้าที่จะเข้ามาดูแลคุณในไม่ช้าครับ",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, escalateMsg]);
    } catch {
      setError("ไม่สามารถส่งต่อให้เจ้าหน้าที่ได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setEscalating(false);
    }
  };

  const handleReset = async () => {
    if (loading || escalating) return;
    const confirmed = window.confirm("คุณต้องการเริ่มการสนทนาใหม่ใช่หรือไม่?");
    if (!confirmed) return;

    try {
      setLoading(true);
      await resetCsChat();
      setConversationId(null);
      setStatus("ACTIVE");
      setMessages([]);
      setError(null);
    } catch {
      setError("ไม่สามารถเริ่มการสนทนาใหม่ได้");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[750px] w-full flex-col rounded-3xl border border-line bg-white shadow-lift overflow-hidden">
      {/* ─── Top Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between border-b border-line bg-white px-5 py-3.5 gap-2">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Headphones className="h-5 w-5" />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                status === "ESCALATED"
                  ? "bg-amber-500 animate-pulse"
                  : status === "CLOSED"
                    ? "bg-slate-400"
                    : "bg-emerald-500"
              }`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-ink">ฝ่ายบริการลูกค้า TEENSTYLE</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  status === "ESCALATED"
                    ? "bg-amber-100 text-amber-800"
                    : status === "CLOSED"
                      ? "bg-slate-100 text-slate-600"
                      : "bg-lilac text-brand-dark"
                }`}
              >
                {status === "ESCALATED"
                  ? "รอเจ้าหน้าที่"
                  : status === "CLOSED"
                    ? "ปิดการสนทนาแล้ว"
                    : "AI Support 24 ชม."}
              </span>
            </div>
            <p className="text-xs text-muted">
              {status === "ESCALATED"
                ? "เจ้าหน้าที่ได้รับแจ้งเรื่องแล้วและกำลังเข้ามาดูแลครับ"
                : "ตอบทันทีเรื่องพัสดุ ค่าส่ง นโยบายคืนสินค้า หรือส่งต่อเจ้าหน้าที่"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status !== "ESCALATED" && status !== "CLOSED" && (
            <button
              type="button"
              onClick={handleEscalate}
              disabled={escalating || loading || !conversationId}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {escalating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCheck className="h-3.5 w-3.5 text-amber-700" />
              )}
              <span>ขอคุยกับเจ้าหน้าที่</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            title="เริ่มการสนทนาใหม่"
            aria-label="เริ่มการสนทนาใหม่"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-brand hover:text-brand"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ─── Status Notification Banner ───────────────────────────────────────── */}
      {status === "ESCALATED" && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50/80 px-5 py-2.5 text-xs text-amber-900">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="flex-1">
            <strong>ส่งต่อให้เจ้าหน้าที่คนจริงแล้ว:</strong>{" "}
            เจ้าหน้าที่ได้รับแจ้งเตือนและกำลังเข้ามาดูแลการสนทนานี้
            คุณสามารถพิมพ์ข้อความทิ้งไว้ได้เลยครับ
          </p>
        </div>
      )}

      {/**
       * ─── Chat Body ─────────────────────────────────────────────────────────
       * `aria-live="polite"` จำเป็น เพราะคำตอบของ AI และของเจ้าหน้าที่ไหลเข้ามาเองโดยที่
       * ผู้ใช้ไม่ได้ย้าย focus — ถ้าไม่ประกาศ ผู้ใช้ screen reader จะไม่รู้เลยว่ามีใครตอบแล้ว
       */}
      <div
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40"
      >
        {initialLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-xs">กำลังเชื่อมต่อฝ่ายบริการลูกค้า...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-lilac-50 text-brand mb-3 shadow-xs">
              <Bot className="h-8 w-8" />
            </div>
            <h3 className="text-base font-bold text-ink mb-1">
              ยินดีต้อนรับสู่ TEENSTYLE Customer Service 💜
            </h3>
            <p className="max-w-md text-xs text-muted mb-6">
              มีข้อสงสัยเกี่ยวกับคำสั่งซื้อ สินค้า การจัดส่ง หรือนโยบายการคืนสินค้า
              สามารถพิมพ์สอบถามได้ทันที หรือเลือกหัวข้อด้านล่างนี้ได้เลยครับ
            </p>
            <CsQuickChips onSelectPrompt={(p) => handleSend(p)} disabled={loading} />
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === "USER";
            const isSystem = msg.role === "SYSTEM";
            const isAgent = msg.role === "AGENT";

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-lilac bg-lilac-50/90 px-3.5 py-1 text-[11px] font-medium text-brand-dark shadow-2xs">
                    <CheckCircle2 className="h-3 w-3 text-brand" />
                    <span>{msg.content}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                      isAgent ? "bg-blue-600 text-white shadow-xs" : "bg-brand text-white shadow-xs"
                    }`}
                  >
                    {isAgent ? <Headphones className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[75%] ${isUser ? "text-right" : "text-left"}`}
                >
                  {!isUser && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-bold text-ink">
                        {isAgent ? "เจ้าหน้าที่ TEENSTYLE" : "AI Customer Service"}
                      </span>
                      {isAgent && (
                        <span className="rounded bg-blue-100 px-1.5 py-px text-[9px] font-semibold text-blue-700">
                          Staff
                        </span>
                      )}
                    </div>
                  )}

                  <div
                    className={`rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed whitespace-pre-line shadow-xs ${
                      isUser
                        ? "rounded-tr-xs bg-brand text-white"
                        : isAgent
                          ? "rounded-tl-xs border border-blue-200 bg-blue-50/70 text-blue-950 font-normal"
                          : "rounded-tl-xs border border-line bg-white text-ink"
                    }`}
                  >
                    {msg.content}
                  </div>

                  <span className="mt-1 block text-[10px] text-muted">
                    {new Date(msg.createdAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {isUser && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700 text-xs">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex items-center gap-2 text-muted text-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <Bot className="h-4 w-4 animate-bounce" />
            </div>
            <div className="rounded-2xl rounded-tl-xs border border-line bg-white px-4 py-2.5 shadow-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand animate-ping" />
                <span className="text-xs text-muted">กำลังค้นหาข้อมูลและพิมพ์คำตอบ...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── Bottom Error Notice ─────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 flex items-center justify-between"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-900 underline font-semibold ml-2"
          >
            ปิด
          </button>
        </div>
      )}

      {/* ─── Bottom Input Bar ────────────────────────────────────────────────── */}
      <div className="border-t border-line bg-white p-3 sm:p-4">
        {messages.length > 0 && status !== "CLOSED" && (
          <div className="mb-2 hidden sm:block">
            <CsQuickChips onSelectPrompt={(p) => handleSend(p)} disabled={loading} />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading || status === "CLOSED"}
            placeholder={
              status === "CLOSED"
                ? "การสนทนานี้ปิดแล้ว กรุณากดปุ่มเริ่มใหม่เพื่อคุยต่อ"
                : status === "ESCALATED"
                  ? "พิมพ์ข้อความถึงเจ้าหน้าที่..."
                  : "พิมพ์คำถาม เช่น เช็คพัสดุ ORD-..., ค่าส่ง, หรือคุยกับเจ้าหน้าที่..."
            }
            className="flex-1 rounded-full border border-line bg-slate-50 px-4 py-2.5 text-xs sm:text-sm text-ink placeholder:text-muted focus:border-brand focus:bg-white focus:outline-hidden disabled:cursor-not-allowed disabled:bg-slate-100"
          />

          <button
            type="submit"
            disabled={!inputText.trim() || loading || status === "CLOSED"}
            aria-label="ส่งข้อความ"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-soft transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
