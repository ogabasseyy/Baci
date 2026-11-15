import 'server-only';

import {
  type MerchantInboxConversation,
  type MerchantInboxMessage,
  providerInboxConversationListSchema,
  providerInboxMessageListSchema,
} from '@/schemas/merchant-inbox';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import {
  projectMerchantInboxConversation,
  projectMerchantInboxMessage,
} from './merchant-inbox-projection';

const REQUEST_TIMEOUT_MS = 8_000;
export const MERCHANT_INBOX_PAGE_SIZE = 25;

export type MerchantInboxFailure = {
  ok: false;
  code: 'not_found' | 'unavailable';
};

type ProviderResponse =
  | { ok: true; body: unknown }
  | { ok: false; status: number | null };

async function providerGet(
  binding: MerchantInboxBinding,
  path: string,
  query?: Record<string, string>
): Promise<ProviderResponse> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, status: null };
  }
}

function failure(response: { status: number | null }): MerchantInboxFailure {
  return {
    ok: false,
    code: response.status === 404 ? 'not_found' : 'unavailable',
  };
}

/** Lists the bound inbox's conversations, most recently active first. */
export async function listMerchantInboxConversations(
  binding: MerchantInboxBinding,
  input: { page: number; status: 'open' | 'resolved' | 'pending' | 'all' }
): Promise<
  | { ok: true; conversations: MerchantInboxConversation[]; hasMore: boolean }
  | MerchantInboxFailure
> {
  const response = await providerGet(binding, '/conversations', {
    inbox_id: String(binding.inboxId),
    page: String(input.page),
    sort_by: 'last_activity_at_desc',
    status: input.status,
  });
  if (!response.ok) return failure(response);
  const parsed = providerInboxConversationListSchema.safeParse(response.body);
  if (!parsed.success) return { ok: false, code: 'unavailable' };
  const { payload } = parsed.data.data;
  const conversations = payload
    .map((raw) => projectMerchantInboxConversation(raw, binding.inboxId))
    .filter((value): value is MerchantInboxConversation => value !== null);
  return {
    ok: true,
    conversations,
    hasMore: payload.length >= MERCHANT_INBOX_PAGE_SIZE,
  };
}

/**
 * Loads one conversation only if it sits in the bound inbox. Every read or
 * write on a conversation goes through this check first, so a conversation
 * id from another store's inbox is indistinguishable from a missing one.
 */
export async function getMerchantInboxConversation(
  binding: MerchantInboxBinding,
  conversationId: number
): Promise<
  { ok: true; conversation: MerchantInboxConversation } | MerchantInboxFailure
> {
  const response = await providerGet(
    binding,
    `/conversations/${conversationId}`
  );
  if (!response.ok) return failure(response);
  const conversation = projectMerchantInboxConversation(
    response.body,
    binding.inboxId
  );
  if (!conversation || conversation.id !== conversationId) {
    return { ok: false, code: 'not_found' };
  }
  return { ok: true, conversation };
}

/** Returns one page of a bound conversation's messages, oldest first. */
export async function listMerchantInboxMessages(
  binding: MerchantInboxBinding,
  input: { conversationId: number; before?: number }
): Promise<
  | {
      ok: true;
      conversation: MerchantInboxConversation;
      messages: MerchantInboxMessage[];
    }
  | MerchantInboxFailure
> {
  const owned = await getMerchantInboxConversation(
    binding,
    input.conversationId
  );
  if (!owned.ok) return owned;
  const response = await providerGet(
    binding,
    `/conversations/${input.conversationId}/messages`,
    input.before ? { before: String(input.before) } : undefined
  );
  if (!response.ok) return failure(response);
  const parsed = providerInboxMessageListSchema.safeParse(response.body);
  if (!parsed.success) return { ok: false, code: 'unavailable' };
  const messages = parsed.data.payload
    .map(projectMerchantInboxMessage)
    .filter((value): value is MerchantInboxMessage => value !== null)
    .sort((left, right) => left.id - right.id);
  return { ok: true, conversation: owned.conversation, messages };
}

/**
 * Sends the merchant's reply into a bound conversation. A timeout or network
 * loss after submission is reported as `delivery_unknown`: the message may
 * have been accepted, so nothing is retried here.
 */
export async function sendMerchantInboxReply(
  binding: MerchantInboxBinding,
  input: { conversationId: number; content: string }
): Promise<
  | { ok: true; message: MerchantInboxMessage }
  | MerchantInboxFailure
  | { ok: false; code: 'delivery_unknown' }
> {
  const owned = await getMerchantInboxConversation(
    binding,
    input.conversationId
  );
  if (!owned.ok) return owned;

  const url = new URL(
    `/api/v1/accounts/${binding.accountId}/conversations/${input.conversationId}/messages`,
    binding.apiOrigin
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      body: JSON.stringify({
        content: input.content,
        message_type: 'outgoing',
        private: false,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'delivery_unknown' };
  }
  if (!response.ok) {
    // A definite provider rejection: nothing was sent.
    return response.status >= 500
      ? { ok: false, code: 'delivery_unknown' }
      : failure(response);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'delivery_unknown' };
  }
  const message = projectMerchantInboxMessage(body);
  // Accepted by the provider, but the echo was unreadable: do not invite a
  // resend that would duplicate the customer-visible message.
  if (!message) return { ok: false, code: 'delivery_unknown' };
  return { ok: true, message };
}
