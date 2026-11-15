import type { z } from 'zod';
import { buildCsrfHeaders } from '@/lib/csrf';
import {
  type MerchantInboxConversation,
  type MerchantInboxMessage,
  merchantInboxConversationsResponseSchema,
  merchantInboxReplyResponseSchema,
  merchantInboxThreadResponseSchema,
} from '@/schemas/merchant-inbox';

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

const BASE_PATH = '/api/merchant/inbox/conversations';

async function failureFrom(
  response: Response
): Promise<MerchantInboxApiFailure> {
  let code: unknown;
  try {
    code = ((await response.json()) as { code?: unknown }).code;
  } catch {
    code = null;
  }
  return {
    ok: false,
    code:
      typeof code === 'string' && KNOWN_CODES.has(code)
        ? (code as MerchantInboxApiErrorCode)
        : 'temporarily_unavailable',
  };
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
  if (!response.ok) return failureFrom(response);
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
