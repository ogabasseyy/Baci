import 'server-only';

import {
  type MerchantInboxConversation,
  providerInboxFilteredListSchema,
} from '@/schemas/merchant-inbox';
import type { MerchantInboxFailure } from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import { projectMerchantInboxConversation } from './merchant-inbox-projection';

const REQUEST_TIMEOUT_MS = 8_000;
/** The engine answers a filtered list 25 chats to a page (v4.19.1). */
const FILTER_PAGE_SIZE = 25;
const PATH = '/conversations/filter';

/** One request for up to a page of chats; null when no usable answer came. */
async function filterRows(
  binding: MerchantInboxBinding,
  ids: number[]
): Promise<unknown[] | null> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${PATH}`,
    binding.apiOrigin
  );
  url.searchParams.set('page', '1');
  const logFailure = (status: number | null) =>
    // Status only: never the token or the response body.
    console.error('[merchant-inbox] provider request failed', {
      status,
      path: PATH,
    });
  try {
    // A read: the engine only takes a filter as a request body.
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      body: JSON.stringify({
        payload: [
          {
            attribute_key: 'inbox_id',
            filter_operator: 'equal_to',
            values: [binding.inboxId],
            query_operator: 'AND',
          },
          {
            attribute_key: 'display_id',
            filter_operator: 'equal_to',
            values: ids,
          },
        ],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logFailure(response.status);
      return null;
    }
    const parsed = providerInboxFilteredListSchema.safeParse(
      await response.json()
    );
    if (parsed.success) return parsed.data.payload;
    logFailure(response.status);
    return null;
  } catch {
    logFailure(null);
    return null;
  }
}

/**
 * Reads many chats of the bound inbox at once, a page of ids per request, in
 * place of one request per chat. A chat that is gone or belongs to another
 * inbox is absent from the map: the filter asks for the bound inbox only and
 * the projection checks each row again. Any request failing fails the whole
 * read, so a caller never shows a list that silently lacks a chat.
 */
export async function readMerchantInboxConversationsById(
  binding: MerchantInboxBinding,
  ids: number[]
): Promise<
  | { ok: true; conversations: Map<number, MerchantInboxConversation> }
  | MerchantInboxFailure
> {
  const chunks: number[][] = [];
  for (let start = 0; start < ids.length; start += FILTER_PAGE_SIZE) {
    chunks.push(ids.slice(start, start + FILTER_PAGE_SIZE));
  }
  const answers = await Promise.all(
    chunks.map((chunk) => filterRows(binding, chunk))
  );

  const asked = new Set(ids);
  const conversations = new Map<number, MerchantInboxConversation>();
  for (const rows of answers) {
    if (!rows) return { ok: false, code: 'unavailable' };
    for (const row of rows) {
      const conversation = projectMerchantInboxConversation(
        row,
        binding.inboxId
      );
      if (conversation && asked.has(conversation.id)) {
        conversations.set(conversation.id, conversation);
      }
    }
  }
  return { ok: true, conversations };
}
