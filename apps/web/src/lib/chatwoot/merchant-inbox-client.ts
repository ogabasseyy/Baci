import 'server-only';

import {
  type MerchantInboxConversation,
  type MerchantInboxMessage,
  providerInboxConversationListSchema,
  providerInboxMessageListSchema,
} from '@/schemas/merchant-inbox';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import { readCustomerLinkToken } from './merchant-inbox-customer-link';
import { buildMerchantInboxListRows } from './merchant-inbox-list-rows';
import {
  compareMerchantInboxMessages,
  projectMerchantInboxConversation,
  projectMerchantInboxMessage,
} from './merchant-inbox-projection';
import {
  type MerchantInboxView,
  providerQueryForView,
} from './merchant-inbox-views';

const REQUEST_TIMEOUT_MS = 8_000;

export type MerchantInboxFailure = {
  ok: false;
  code: 'not_found' | 'unavailable';
};

type ProviderResponse =
  | { ok: true; body: unknown }
  | { ok: false; status: number | null };

export async function providerGet(
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
    if (!response.ok) {
      // Status only: never the token, URL query or response body.
      console.error('[merchant-inbox] provider request failed', {
        status: response.status,
        path,
      });
      return { ok: false, status: response.status };
    }
    return { ok: true, body: await response.json() };
  } catch {
    console.error('[merchant-inbox] provider request failed', {
      status: null,
      path,
    });
    return { ok: false, status: null };
  }
}

export function failure(response: {
  status: number | null;
}): MerchantInboxFailure {
  return {
    ok: false,
    code: response.status === 404 ? 'not_found' : 'unavailable',
  };
}

/** Lists the bound inbox's conversations, most recently active first. */
export async function listMerchantInboxConversations(
  binding: MerchantInboxBinding,
  input: {
    page: number;
    status: 'open' | 'resolved' | 'pending' | 'snoozed' | 'all';
    /** A smart view; it replaces `status` and narrows the rows. */
    view?: MerchantInboxView;
  }
): Promise<
  | {
      ok: true;
      conversations: MerchantInboxConversation[];
      hasMore: boolean;
      /** Signed customer links by conversation id; verify before use. */
      links: Record<number, string>;
    }
  | MerchantInboxFailure
> {
  const viewQuery = input.view ? providerQueryForView(input.view) : null;
  const query: Record<string, string> = {
    inbox_id: String(binding.inboxId),
    page: String(input.page),
    sort_by: 'last_activity_at_desc',
    status: viewQuery?.status ?? input.status,
  };
  // Label filter as the provider's array parameter; `matchesView` below
  // applies the same rule again in case a build ignores it.
  const response = await providerGet(
    binding,
    '/conversations',
    viewQuery?.labels?.[0]
      ? { ...query, 'labels[]': viewQuery.labels[0] }
      : query
  );
  if (!response.ok) return failure(response);
  const parsed = providerInboxConversationListSchema.safeParse(response.body);
  if (!parsed.success) return { ok: false, code: 'unavailable' };
  const { payload } = parsed.data.data;
  const { conversations, links } = buildMerchantInboxListRows(
    payload,
    binding.inboxId,
    input.view
  );
  // The provider's page size is a server setting a caller cannot pin, and its
  // total is read before the page rows, so a conversation arriving between
  // the two makes the total stale. Neither is trusted to end paging: any
  // non-empty provider page may have a successor, a page is never skipped,
  // paging ends on an empty page, and the worst case is one empty follow-up
  // fetch. Measured on the provider's page, not on the rows kept for this
  // inbox, because that is what decides whether a next page exists.
  const hasMore = payload.length > 0;
  return { ok: true, conversations, hasMore, links };
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
  | { ok: true; conversation: MerchantInboxConversation; link: string | null }
  | MerchantInboxFailure
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
  return {
    ok: true,
    conversation,
    link: readCustomerLinkToken(response.body),
  };
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
      /** True when an older page may exist; page with `nextBefore`. */
      hasOlder: boolean;
      nextBefore: number | null;
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
    .sort(compareMerchantInboxMessages);
  // The cursor is the oldest provider row, including rows not shown (private
  // notes, activity), so paging never stalls on a page of hidden rows.
  const rawIds = parsed.data.payload
    .map((raw) =>
      raw !== null && typeof raw === 'object'
        ? (raw as { id?: unknown }).id
        : null
    )
    .filter(
      (id): id is number =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0
    );
  // As with conversations, no provider page size is assumed: any non-empty
  // page may have an older one, and paging ends on an empty page.
  const hasOlder = rawIds.length > 0;
  return {
    ok: true,
    conversation: owned.conversation,
    messages,
    hasOlder,
    nextBefore: hasOlder ? Math.min(...rawIds) : null,
  };
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
    // 5xx, a request timeout and throttling do not prove the message was
    // refused. Only another 4xx is a definite rejection: nothing was sent.
    return response.status >= 500 ||
      response.status === 408 ||
      response.status === 429
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
  // The echo must also be the reply itself, not some other row.
  if (message?.sender !== 'store') {
    return { ok: false, code: 'delivery_unknown' };
  }
  return { ok: true, message };
}
