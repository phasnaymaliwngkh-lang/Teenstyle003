import { apiFetch } from "@/lib/api";
import type {
  AIConversationStatus,
  SupportTicketDetail,
  SupportTicketListResult,
} from "@/types/catalog";

/**
 * Service สำหรับระบบฝ่ายบริการลูกค้าและ Ticket หลังบ้าน (STEP 20)
 */

export function fetchSupportConversations(params?: {
  status?: AIConversationStatus;
  page?: number;
  limit?: number;
}): Promise<SupportTicketListResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<SupportTicketListResult>(
    `/api/admin/support/conversations${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
}

export function fetchSupportDetail(id: string): Promise<SupportTicketDetail> {
  return apiFetch<SupportTicketDetail>(`/api/admin/support/conversations/${id}`, {
    cache: "no-store",
  });
}

export function assignSupportTicket(
  id: string,
): Promise<{ success: boolean; assignedTo: { id: string; name: string | null } }> {
  return apiFetch<{ success: boolean; assignedTo: { id: string; name: string | null } }>(
    `/api/admin/support/conversations/${id}/assign`,
    {
      method: "POST",
      cache: "no-store",
    },
  );
}

export function sendSupportReply(
  id: string,
  message: string,
): Promise<{ success: boolean; message: SupportTicketDetail["messages"][number] }> {
  return apiFetch<{ success: boolean; message: SupportTicketDetail["messages"][number] }>(
    `/api/admin/support/conversations/${id}/messages`,
    {
      method: "POST",
      json: { message },
      cache: "no-store",
    },
  );
}

export function updateSupportTicketStatus(
  id: string,
  status: AIConversationStatus,
): Promise<{ success: boolean; status: string }> {
  return apiFetch<{ success: boolean; status: string }>(
    `/api/admin/support/conversations/${id}/status`,
    {
      method: "PATCH",
      json: { status },
      cache: "no-store",
    },
  );
}
