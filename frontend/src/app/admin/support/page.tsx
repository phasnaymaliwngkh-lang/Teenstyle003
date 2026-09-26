"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Headphones,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  User,
  UserCheck,
} from "lucide-react";

import {
  assignSupportTicket,
  fetchSupportConversations,
  fetchSupportDetail,
  sendSupportReply,
  updateSupportTicketStatus,
} from "@/services/admin-support.service";
import { cn } from "@/lib/utils";
import type { AIConversationStatus, SupportTicketDetail, SupportTicketItem } from "@/types/catalog";

export default function AdminSupportPage() {
  const [activeTab, setActiveTab] = useState<AIConversationStatus | "ALL">("ESCALATED");
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [counts, setCounts] = useState({ all: 0, escalated: 0, active: 0, closed: 0 });
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTickets = async () => {
    try {
      setLoadingList(true);
      setErrorMessage(null);
      const res = await fetchSupportConversations({
        status: activeTab === "ALL" ? undefined : activeTab,
      });
      setTickets(res.items);
      setCounts(res.counts);

      if (res.items.length > 0 && !selectedTicketId && res.items[0]) {
        setSelectedTicketId(res.items[0].id);
      }
    } catch (err) {
      console.error("Failed to load support tickets:", err);
      setErrorMessage("ไม่สามารถโหลดรายการตั๋วบริการลูกค้าได้");
    } finally {
      setLoadingList(false);
    }
  };

  const handleTabChange = (tab: AIConversationStatus | "ALL") => {
    setActiveTab(tab);
    setLoadingList(true);
    setSelectedTicketId(null);
    setTicketDetail(null);
  };

  const handleSelectTicket = (id: string) => {
    setSelectedTicketId(id);
    setLoadingDetail(true);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchSupportConversations({
          status: activeTab === "ALL" ? undefined : activeTab,
        });
        if (!cancelled) {
          setTickets(res.items);
          setCounts(res.counts);
          if (res.items.length > 0 && res.items[0]) {
            setSelectedTicketId(res.items[0].id);
            setLoadingDetail(true);
          }
          setLoadingList(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load support tickets:", err);
          setErrorMessage("ไม่สามารถโหลดรายการตั๋วบริการลูกค้าได้");
          setLoadingList(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (!selectedTicketId) return;

    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchSupportDetail(selectedTicketId);
        if (!cancelled) {
          setTicketDetail(detail);
          setLoadingDetail(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load ticket detail:", err);
          setLoadingDetail(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTicketId]);

  const handleAssign = async () => {
    if (!selectedTicketId || actionLoading) return;
    try {
      setActionLoading(true);
      await assignSupportTicket(selectedTicketId);
      // โหลดรายละเอียดใหม่
      const detail = await fetchSupportDetail(selectedTicketId);
      setTicketDetail(detail);
      loadTickets();
    } catch (err) {
      console.error("Failed to assign ticket:", err);
      alert("ไม่สามารถรับเรื่องได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!selectedTicketId || !text || sendingReply) return;

    try {
      setSendingReply(true);
      await sendSupportReply(selectedTicketId, text);
      setReplyText("");
      const detail = await fetchSupportDetail(selectedTicketId);
      setTicketDetail(detail);
      loadTickets();
    } catch (err) {
      console.error("Failed to send support reply:", err);
      alert("ไม่สามารถส่งข้อความตอบกลับได้");
    } finally {
      setSendingReply(false);
    }
  };

  const handleStatusChange = async (newStatus: AIConversationStatus) => {
    if (!selectedTicketId || actionLoading) return;
    try {
      setActionLoading(true);
      await updateSupportTicketStatus(selectedTicketId, newStatus);
      const detail = await fetchSupportDetail(selectedTicketId);
      setTicketDetail(detail);
      loadTickets();
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("ไม่สามารถเปลี่ยนสถานะได้");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <main className="mx-auto flex h-[calc(100vh-65px)] w-full max-w-[1400px] flex-col px-4 py-4 sm:px-6">
      {/* ─── Page Title Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
        <div>
          <h1 className="text-2xl font-black text-ink">
            ฝ่ายบริการลูกค้า (Customer Support Queue)
          </h1>
          <p className="text-xs text-muted">
            จัดการคำร้องที่ส่งต่อจาก AI (Human Handoff) และตอบกลับข้อความลูกค้าแบบเรียลไทม์
          </p>
        </div>

        <button
          type="button"
          onClick={loadTickets}
          disabled={loadingList}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`} />
          <span>รีเฟรช</span>
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-xl bg-danger/5 p-3 text-xs font-semibold text-danger border border-danger/25"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ─── Main Content Split Pane ───────────────────────────────────────────── */}
      <div className="mt-3 flex flex-1 overflow-hidden gap-4 rounded-2xl border border-line bg-white shadow-soft">
        {/* ─── Left Column: Ticket List ────────────────────────────────────────── */}
        <div
          className={cn(
            "flex w-full shrink-0 flex-col border-r border-line bg-lilac-50/50 md:w-[380px] lg:w-[420px]",
            // จอเล็กมีที่พอแค่คอลัมน์เดียว — เปิดเคสแล้วสลับไปแสดงห้องแชตแทนรายการ
            selectedTicketId && "hidden md:flex",
          )}
        >
          {/* Status Tabs */}
          <div className="flex border-b border-line p-2 gap-1 bg-white">
            <button
              type="button"
              onClick={() => handleTabChange("ESCALATED")}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition ${
                activeTab === "ESCALATED"
                  ? "bg-warning/10 text-warning shadow-2xs"
                  : "text-muted hover:bg-lilac-50"
              }`}
            >
              <span>รอรับเรื่อง</span>
              <span className="rounded-full bg-warning/15 px-1.5 py-0.2 text-[10px] text-warning">
                {counts.escalated}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("ACTIVE")}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition ${
                activeTab === "ACTIVE"
                  ? "bg-brand/10 text-brand shadow-2xs"
                  : "text-muted hover:bg-lilac-50"
              }`}
            >
              <span>กำลังคุย</span>
              <span className="rounded-full bg-lilac px-1.5 py-0.2 text-[10px] text-ink-soft">
                {counts.active}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("CLOSED")}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition ${
                activeTab === "CLOSED"
                  ? "bg-lilac text-ink shadow-2xs"
                  : "text-muted hover:bg-lilac-50"
              }`}
            >
              <span>ปิดแล้ว</span>
              <span className="rounded-full bg-line px-1.5 py-0.2 text-[10px] text-ink">
                {counts.closed}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTabChange("ALL")}
              className={`flex min-h-11 items-center justify-center rounded-xl px-2.5 text-xs font-bold transition ${
                activeTab === "ALL"
                  ? "bg-ink-soft text-white shadow-2xs"
                  : "text-muted hover:bg-lilac-50"
              }`}
            >
              <span>ทั้งหมด ({counts.all})</span>
            </button>
          </div>

          {/**
           * Ticket Items Scrollable List
           * `aria-live` เพราะรายการเปลี่ยนเองเมื่อสลับแท็บ/กดรีเฟรช โดยผู้ใช้ไม่ได้ย้าย focus
           */}
          <div
            aria-live="polite"
            aria-busy={loadingList}
            className="flex-1 overflow-y-auto p-2 space-y-2"
          >
            {loadingList ? (
              <div className="flex h-40 items-center justify-center text-muted">
                <Loader2 className="h-5 w-5 animate-spin text-brand mr-2" aria-hidden />
                <span className="text-xs">กำลังโหลดตั๋ว...</span>
              </div>
            ) : tickets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center p-4">
                <CheckCircle2 className="h-8 w-8 text-success mb-2" />
                <p className="text-xs font-semibold text-ink">ไม่มีรายการในหมวดนี้</p>
                <p className="text-[11px] text-muted">คำร้องทั้งหมดได้รับการจัดการเรียบร้อยแล้ว</p>
              </div>
            ) : (
              tickets.map((t) => {
                const isSelected = t.id === selectedTicketId;
                const isEscalated = t.status === "ESCALATED";

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleSelectTicket(t.id)}
                    className={`w-full text-left rounded-xl p-3 border transition ${
                      isSelected
                        ? "border-brand bg-white shadow-xs"
                        : "border-transparent bg-white/70 hover:bg-white hover:border-line"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-bold text-xs text-ink truncate">
                          {t.user?.name || t.user?.email || "ลูกค้าทั่วไป (Guest)"}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          isEscalated
                            ? "bg-warning/10 text-warning animate-pulse"
                            : t.status === "CLOSED"
                              ? "bg-lilac-50 text-muted"
                              : "bg-success/10 text-success"
                        }`}
                      >
                        {isEscalated ? "รอตอบ" : t.status === "CLOSED" ? "ปิดเคส" : "Active"}
                      </span>
                    </div>

                    <p className="text-xs text-ink-soft line-clamp-2 mb-2">
                      {t.lastMessage ? t.lastMessage.content : "(ไม่มีข้อความ)"}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-muted pt-1 border-t border-line">
                      <span>
                        {t.assignedTo
                          ? `ผู้ดูแล: ${t.assignedTo.name || t.assignedTo.email}`
                          : "ยังไม่มีผู้รับเคส"}
                      </span>
                      <span>
                        {t.lastMessageAt
                          ? new Date(t.lastMessageAt).toLocaleTimeString("th-TH", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ─── Right Column: Chat History & Action Pane ────────────────────────── */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden bg-white",
            !selectedTicketId && "hidden md:flex",
          )}
        >
          {loadingDetail ? (
            <div className="flex h-full flex-col items-center justify-center text-muted">
              <Loader2 className="h-6 w-6 animate-spin text-brand mb-2" />
              <span className="text-xs font-semibold">กำลังโหลดรายละเอียดบทสนทนา...</span>
            </div>
          ) : ticketDetail ? (
            <>
              {/* Header Details */}
              <div className="flex flex-wrap items-center justify-between border-b border-line px-5 py-3 gap-2 bg-lilac-50/40">
                {/* จอเล็กสลับมาแสดงห้องแชตแทนรายการ จึงต้องมีทางกลับ (STEP 31) */}
                <button
                  type="button"
                  onClick={() => setSelectedTicketId(null)}
                  aria-label="กลับไปรายการเคส"
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white text-muted transition hover:border-brand hover:text-brand md:hidden"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>

                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <h2 className="text-sm font-bold text-ink">
                      {ticketDetail.user?.name || "ลูกค้าทั่วไป"}
                    </h2>
                    {ticketDetail.user?.email && (
                      <span className="max-w-full text-xs break-all text-muted">
                        ({ticketDetail.user.email})
                      </span>
                    )}
                    {ticketDetail.user?.phone && (
                      <span className="text-xs text-muted">· {ticketDetail.user.phone}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>
                      สถานะ:{" "}
                      <strong className={ticketDetail.status === "ESCALATED" ? "text-warning" : ""}>
                        {ticketDetail.status}
                      </strong>
                    </span>
                    <span>·</span>
                    <span>
                      ผู้รับผิดชอบ:{" "}
                      <strong>
                        {ticketDetail.assignedTo?.name ||
                          ticketDetail.assignedTo?.email ||
                          "ยังไม่มี"}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!ticketDetail.assignedTo && (
                    <button
                      type="button"
                      onClick={handleAssign}
                      disabled={actionLoading}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-brand-dark disabled:opacity-50"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>รับเรื่องเคสนี้</span>
                    </button>
                  )}

                  {ticketDetail.status !== "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => handleStatusChange("CLOSED")}
                      disabled={actionLoading}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink-soft transition hover:bg-lilac-50 disabled:opacity-50"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>ปิดเคสนี้</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStatusChange("ACTIVE")}
                      disabled={actionLoading}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink transition hover:bg-lilac-50 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>เปิดเคสใหม่</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Transcript Area */}
              {/* ไทม์ไลน์แชต — ข้อความใหม่ไหลเข้ามาเองหลังกดส่ง จึงต้องประกาศให้ screen reader รู้ */}
              <div
                aria-live="polite"
                aria-relevant="additions"
                className="flex-1 overflow-y-auto p-5 space-y-3 bg-lilac-50/20"
              >
                {ticketDetail.messages.map((m) => {
                  const isUser = m.role === "USER";
                  const isSystem = m.role === "SYSTEM";
                  const isAgent = m.role === "AGENT";

                  if (isSystem) {
                    return (
                      <div key={m.id} className="flex justify-center my-2">
                        <span className="rounded-full bg-lilac-50 border border-line px-3 py-0.5 text-[11px] font-medium text-muted">
                          {m.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 ${isUser ? "justify-start" : "justify-end"}`}
                    >
                      {isUser && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-lilac text-ink-soft text-xs">
                          <User className="h-3.5 w-3.5" />
                        </div>
                      )}

                      <div className={`max-w-[75%] ${isUser ? "text-left" : "text-right"}`}>
                        <div className="flex items-center gap-1.5 mb-0.5 text-[11px] text-muted">
                          <span>
                            {isUser
                              ? "ลูกค้า"
                              : isAgent
                                ? "เจ้าหน้าที่ (คุณ/Staff)"
                                : "AI Customer Service"}
                          </span>
                          <span>·</span>
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString("th-TH", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <div
                          className={`rounded-2xl p-3 text-xs sm:text-sm whitespace-pre-line shadow-2xs ${
                            isUser
                              ? "rounded-tl-xs bg-white border border-line text-ink"
                              : isAgent
                                ? "rounded-tr-xs bg-brand-dark text-white"
                                : "rounded-tr-xs bg-lilac/70 text-brand-dark border border-lilac"
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>

                      {!isUser && (
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                            isAgent ? "bg-brand-dark text-white" : "bg-brand text-white"
                          }`}
                        >
                          {isAgent ? (
                            <Headphones className="h-3.5 w-3.5" />
                          ) : (
                            <Bot className="h-3.5 w-3.5" />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Reply Input Bar */}
              <div className="border-t border-line bg-white p-3">
                <form onSubmit={handleReply} className="flex items-center gap-2">
                  <label htmlFor="support-reply" className="sr-only">
                    ข้อความตอบกลับลูกค้า
                  </label>
                  <input
                    id="support-reply"
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    disabled={sendingReply || ticketDetail.status === "CLOSED"}
                    placeholder={
                      ticketDetail.status === "CLOSED"
                        ? "เคสนี้ปิดแล้ว หากต้องการพิมพ์ตอบให้เปิดเคสใหม่ก่อน"
                        : "พิมพ์ข้อความตอบกลับลูกค้าในฐานะเจ้าหน้าที่..."
                    }
                    className="h-11 flex-1 rounded-full border border-line bg-lilac-50 px-4 text-xs sm:text-sm text-ink placeholder:text-muted focus:border-brand focus:bg-white focus:outline-hidden disabled:bg-lilac-50"
                  />

                  <button
                    type="submit"
                    disabled={!replyText.trim() || sendingReply || ticketDetail.status === "CLOSED"}
                    aria-label="ส่งข้อความตอบกลับ"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-dark text-white shadow-soft transition hover:bg-brand-dark disabled:opacity-40"
                  >
                    {sendingReply ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted">
              <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-semibold">เลือกบทสนทนาจากรายการทางซ้าย</p>
              <p className="text-xs">เพื่อดูประวัติและพิมพ์ข้อความตอบกลับลูกค้า</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
