import {
  type InboxConversation,
  type InboxConversationsPage,
  type InboxCustomerProfile,
  type InboxMessage,
  type InboxSearchResponse,
  type InboxThreadPage,
  type InboxUpdate,
  type InboxView,
  inboxConversationsResponseSchema,
  inboxCustomerResponseSchema,
  inboxReplyResponseSchema,
  inboxSearchResponseSchema,
  inboxThreadResponseSchema,
  inboxUpdateResponseSchema,
} from '@/schemas/merchant-inbox';
import { apiClient, NetworkError } from './api-client';

const BASE = '/api/merchant/inbox/conversations';

/** One page of the signed-in merchant's shopper conversations, for one view. */
export async function fetchInboxConversations(
  page: number,
  view: InboxView = 'all'
): Promise<InboxConversationsPage> {
  const data = await apiClient<unknown>(`${BASE}?page=${page}&view=${view}`);
  return inboxConversationsResponseSchema.parse(data);
}

/** Done, follow-up, priority and tags. Safe to repeat: it sets state. */
export async function updateInboxConversation(
  conversationId: number,
  update: InboxUpdate
): Promise<InboxConversation> {
  const data = await apiClient<unknown>(`${BASE}/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
  return inboxUpdateResponseSchema.parse(data).conversation;
}

/** The signed-in customer behind a chat, or null for a guest chat. */
export async function fetchInboxCustomer(
  conversationId: number
): Promise<InboxCustomerProfile | null> {
  const data = await apiClient<unknown>(`${BASE}/${conversationId}/customer`);
  return inboxCustomerResponseSchema.parse(data).customer;
}

/** Chats matching a name, contact or message text. */
export async function searchInbox(
  term: string,
  page = 1
): Promise<InboxSearchResponse> {
  const data = await apiClient<unknown>(
    `${BASE}/search?q=${encodeURIComponent(term)}&page=${page}`
  );
  return inboxSearchResponseSchema.parse(data);
}

/** The newest messages of a conversation, or the page before `before`. */
export async function fetchInboxThread(
  conversationId: number,
  before?: number
): Promise<InboxThreadPage> {
  const query = before ? `?before=${before}` : '';
  const data = await apiClient<unknown>(
    `${BASE}/${conversationId}/messages${query}`
  );
  return inboxThreadResponseSchema.parse(data);
}

/** Sends a store reply. The server has no idempotency key: never auto-retry. */
export async function sendInboxReply(
  conversationId: number,
  content: string
): Promise<InboxMessage> {
  const data = await apiClient<unknown>(`${BASE}/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  return inboxReplyResponseSchema.parse(data).message;
}

/**
 * A rejected reply is "definitely not sent" only when the server answered
 * with a 4xx status. A timeout, dropped connection, 5xx or unreadable answer
 * may still have delivered the message, so the caller must check the thread
 * before offering a resend.
 */
export function isDefinitelyNotSent(error: unknown): boolean {
  return (
    error instanceof NetworkError &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 408
  );
}
