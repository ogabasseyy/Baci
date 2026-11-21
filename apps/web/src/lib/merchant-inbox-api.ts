import type { z } from 'zod';
import { buildCsrfHeaders } from '@/lib/csrf';
import {
  type MerchantInboxConversation,
  type MerchantInboxMessage,
  merchantInboxConversationsResponseSchema,
  merchantInboxErrorPayloadSchema,
  merchantInboxReplyResponseSchema,
  merchantInboxThreadResponseSchema,
} from '@/schemas/merchant-inbox';
import type { MerchantInboxInsightDays } from '@/schemas/merchant-inbox-insights-query';
import {
  type MerchantInboxInsights,
  merchantInboxInsightsResponseSchema,
} from '@/schemas/merchant-inbox-insights-response';

export type MerchantInboxApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'inbox_unavailable'
  | 'not_found'
  | 'delivery_unknown'
  | 'temporarily_unavailable';

export type MerchantInboxApiFailure = {
  ok: false;
  code: MerchantInboxApiErrorCode;
};

const KNOWN_CODES = new Set<string>([
  'unauthorized',
  'forbidden',
  'inbox_unavailable',
  'not_found',
  'delivery_unknown',
]);

/** Every code this API itself emits; only these prove the server answered. */
const API_CODES = new Set<string>([
  ...KNOWN_CODES,
  'invalid_request',
  'temporarily_unavailable',
]);

function isKnownCode(code: string | null): code is MerchantInboxApiErrorCode {
  return code !== null && KNOWN_CODES.has(code);
}

const BASE_PATH = '/api/merchant/inbox/conversations';

async function failureFrom(
  response: Response,
  isReply: boolean
): Promise<MerchantInboxApiFailure> {
  let code: string | null = null;
  try {
    const parsed = merchantInboxErrorPayloadSchema.safeParse(
      await response.json()
    );
    code = parsed.success ? parsed.data.code : null;
  } catch {
    code = null;
  }
  if (isKnownCode(code)) {
    return { ok: false, code };
  }
  // A reply that failed without a code this API emits (a bare gateway
  // 502/504, an HTML page) may still have been delivered: never report it
  // as "not sent, try again", which invites a duplicate.
  if (isReply && !(code !== null && API_CODES.has(code))) {
    return { ok: false, code: 'delivery_unknown' };
  }
  // No readable code (empty or HTML body): classify by status so a request
  // that can never succeed is not reported as a retryable outage.
  if (response.status === 401) return { ok: false, code: 'unauthorized' };
  if (response.status === 403) return { ok: false, code: 'forbidden' };
  if (response.status === 404) return { ok: false, code: 'not_found' };
  return { ok: false, code: 'temporarily_unavailable' };
}

async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit
): Promise<{ ok: true; data: z.infer<Schema> } | MerchantInboxApiFailure> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      // Never hang a poller (or leave a send spinning) on a stalled socket.
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
  } catch {
    // A lost reply request may still have been delivered.
    return {
      ok: false,
      code:
        init?.method === 'POST'
          ? 'delivery_unknown'
          : 'temporarily_unavailable',
    };
  }
  if (!response.ok) return failureFrom(response, init?.method === 'POST');
  try {
    const parsed = schema.safeParse(await response.json());
    if (parsed.success) return { ok: true, data: parsed.data };
  } catch {
    // Fall through to the shared failure below.
  }
  return {
    ok: false,
    code:
      init?.method === 'POST' ? 'delivery_unknown' : 'temporarily_unavailable',
  };
}

export async function fetchMerchantInboxConversations(): Promise<
  | { ok: true; conversations: MerchantInboxConversation[]; hasMore: boolean }
  | MerchantInboxApiFailure
> {
  const result = await request(
    BASE_PATH,
    merchantInboxConversationsResponseSchema
  );
  if (!result.ok) return result;
  return {
    ok: true,
    conversations: result.data.conversations,
    hasMore: result.data.hasMore,
  };
}

export async function fetchMerchantInboxThread(
  conversationId: number
): Promise<
  { ok: true; messages: MerchantInboxMessage[] } | MerchantInboxApiFailure
> {
  const result = await request(
    `${BASE_PATH}/${conversationId}/messages`,
    merchantInboxThreadResponseSchema
  );
  if (!result.ok) return result;
  return { ok: true, messages: result.data.messages };
}

export async function sendMerchantInboxReply(
  conversationId: number,
  content: string
): Promise<
  { ok: true; message: MerchantInboxMessage } | MerchantInboxApiFailure
> {
  const result = await request(
    `${BASE_PATH}/${conversationId}/messages`,
    merchantInboxReplyResponseSchema,
    {
      method: 'POST',
      headers: buildCsrfHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ content }),
    }
  );
  if (!result.ok) return result;
  return { ok: true, message: result.data.message };
}

export async function fetchMerchantInboxInsights(
  days: MerchantInboxInsightDays
): Promise<
  { ok: true; insights: MerchantInboxInsights } | MerchantInboxApiFailure
> {
  const result = await request(
    `/api/merchant/inbox/insights?days=${days}`,
    merchantInboxInsightsResponseSchema
  );
  return result.ok ? { ok: true, insights: result.data } : result;
}
