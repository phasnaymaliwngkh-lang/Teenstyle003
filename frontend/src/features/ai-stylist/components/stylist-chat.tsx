"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, RotateCcw, Sparkles } from "lucide-react";

import { ProductCard } from "@/features/products/components/product-card";
import { fetchStylistHistory, resetStylistChat, sendStylistChat } from "@/services/ai.service";
import type { StylistMessage, StylistPreferences } from "@/types/catalog";
import { QuickChips } from "./quick-chips";

export function StylistChat() {
  const [messages, setMessages] = useState<StylistMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // โหลดประวัติการคุยเมื่อเปิดหน้าเว็บ
  useEffect(() => {
    async function loadHistory() {
      try {
        setInitialLoading(true);
        setError(null);
        const res = await fetchStylistHistory();
        setConversationId(res.conversationId);
        setMessages(res.messages);
      } catch (err) {
        console.error("Failed to load stylist history:", err);
      } finally {
        setInitialLoading(false);
      }
    }

    loadHistory();
  }, []);

  const handleSend = async (textToSend?: string, preferences?: StylistPreferences) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || loading) return;

    setError(null);
    setInputText("");

    // เพิ่มข้อความของผู้ใช้ทันที (Optimistic UI)
    const tempUserMessage: StylistMessage = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: text,
      referencedProducts: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMessage]);
    setLoading(true);

    try {
      const res = await sendStylistChat({
        message: text,
        conversationId: conversationId ?? undefined,
        preferences,
      });

      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, res.message]);
      if (res.suggestedPrompts?.length > 0) {
        setSuggestedPrompts(res.suggestedPrompts);
      }
    } catch (err) {
      console.error("Error sending stylist message:", err);
      setError("ไม่สามารถส่งข้อความได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleReset = async () => {
    if (loading) return;
    try {
      setLoading(true);
      await resetStylistChat();
      setMessages([]);
      setConversationId(null);
      setSuggestedPrompts([]);
      setError(null);
    } catch (err) {
      console.error("Failed to reset stylist chat:", err);
      setError("ไม่สามารถรีเซ็ตบทสนทนาได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[780px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-soft)]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-line bg-lilac-50/70 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-brand text-white shadow-sm">
            <Sparkles className="size-5" aria-hidden />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-ink">TEENSTYLE AI Stylist</h2>
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ออนไลน์
              </span>
            </div>
            <p className="text-xs text-muted-light">ผู้ช่วยเลือกชุดและแมตช์แฟชั่นจากสินค้าจริง</p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted-light transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-50"
            title="เริ่มคุยใหม่"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">เริ่มคุยใหม่</span>
          </button>
        )}
      </header>

      {/* Message History Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {initialLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-light">
            <Loader2 className="size-6 animate-spin text-brand" />
            <p className="text-sm">กำลังเชื่อมต่อกับ AI Stylist...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-lilac-100 text-brand shadow-inner">
              <Sparkles className="size-8" aria-hidden />
            </div>
            <h3 className="mt-4 text-xl font-bold text-ink">ยินดีต้อนรับสู่ AI Stylist ✧</h3>
            <p className="mt-1.5 max-w-[48ch] text-sm text-muted-light">
              บอกสไตล์ที่ชอบ โอกาสใช้งาน โทนสี หรือช่วงงบประมาณ
              แล้วสไตลิสต์จะคัดสรรสินค้าจริงที่มีสต็อกในร้านพร้อมคำแนะนำให้คุณทันที
            </p>

            <div className="mt-8 w-full max-w-lg rounded-xl border border-dashed border-brand/30 bg-lilac-50/50 p-4">
              <QuickChips
                onSelectPrompt={(prompt, prefs) => handleSend(prompt, prefs)}
                disabled={loading}
              />
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={msg.id || idx}
              className={`flex flex-col ${msg.role === "USER" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "USER"
                    ? "bg-brand text-white rounded-br-xs shadow-sm"
                    : "border border-line bg-gray-50/80 text-ink rounded-bl-xs"
                }`}
              >
                <div className="whitespace-pre-line">{msg.content}</div>
              </div>

              {/* การ์ดสินค้าที่ AI อ้างอิงและแนะนำ */}
              {msg.role === "ASSISTANT" &&
                msg.referencedProducts &&
                msg.referencedProducts.length > 0 && (
                  <div className="mt-3 w-full max-w-2xl">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-brand">
                      <Sparkles className="size-3.5" aria-hidden />
                      สินค้าที่สไตลิสต์แนะนำ (มีสต็อกจริง):
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {msg.referencedProducts.map((product) => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                )}

              <span className="mt-1 px-1 text-[10px] text-muted-light">
                {new Date(msg.createdAt).toLocaleTimeString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-start gap-2 text-muted-light">
            <div className="grid size-8 place-items-center rounded-full bg-lilac-100 text-brand">
              <Sparkles className="size-4 animate-spin" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-gray-50 px-4 py-2.5 text-xs font-medium text-ink">
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span>AI Stylist กำลังค้นหาสินค้าและจัดชุดที่เข้ากัน...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-danger/10 p-3 text-center text-xs font-medium text-danger">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Input Area */}
      <footer className="border-t border-line bg-white p-3 sm:p-4">
        {suggestedPrompts.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5 overflow-x-auto pb-1">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => handleSend(prompt)}
                className="rounded-full border border-lilac-200 bg-lilac-50 px-3 py-1 text-xs text-brand transition hover:bg-lilac-100 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
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
            disabled={loading}
            placeholder="พิมพ์บอกสไตล์ สี โอกาสใช้งาน หรืองบประมาณ..."
            className="flex-1 rounded-[var(--radius-pill)] border border-line bg-gray-50 px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loading || !inputText.trim()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-dark hover:shadow disabled:opacity-40"
            aria-label="ส่งข้อความ"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>

        <p className="mt-2 text-center text-[11px] text-muted-light">
          ✧ AI แนะนำเฉพาะสินค้าที่มีอยู่จริงในร้าน TEENSTYLE เท่านั้น ไม่สร้างข้อมูลปลอม
        </p>
      </footer>
    </div>
  );
}
