import 'server-only';

import {
  type MerchantInboxConversation,
  providerInboxMessageSchema,
} from '@/schemas/merchant-inbox';
import { INBOX_SNIPPET_MAX_LENGTH } from '@/schemas/merchant-inbox-manage';
import {
  failure,
  type MerchantInboxFailure,
  providerGet,
} from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import { projectMerchantInboxConversation } from './merchant-inbox-projection';

export type MerchantInboxSearchResult = {
  conversation: MerchantInboxConversation;
  /** The matching message, shortened; null when the name or contact matched. */
  snippet: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The provider nests the rows under `payload`, sometimes under `data`. */
function payloadRows(body: unknown): unknown[] | null {
  if (!isRecord(body)) return null;
  const direct = body.payload;
  if (Array.isArray(direct)) return direct;
  const nested = isRecord(body.data) ? body.data.payload : null;
  return Array.isArray(nested) ? nested : null;
}

function snippetOf(raw: unknown): string | null {
  if (!isRecord(raw) || !Array.isArray(raw.messages)) return null;
  for (const candidate of raw.messages) {
    const parsed = providerInboxMessageSchema.safeParse(candidate);
    // Private notes are never shown, in search either.
    if (!parsed.success || parsed.data.private === true) continue;
    const text = (parsed.data.content ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, INBOX_SNIPPET_MAX_LENGTH);
  }
  return null;
}

/**
 * Searches the bound inbox by shopper name, contact and message text. The
 * provider searches the whole account, so every row is checked against the
 * bound inbox id before it is returned.
 */
export async function searchMerchantInboxConversations(
  binding: MerchantInboxBinding,
  input: { q: string; page: number }
): Promise<
  | { ok: true; results: MerchantInboxSearchResult[]; hasMore: boolean }
  | MerchantInboxFailure
> {
  const response = await providerGet(binding, '/conversations/search', {
    q: input.q,
    page: String(input.page),
  });
  if (!response.ok) return failure(response);
  const rows = payloadRows(response.body);
  if (!rows) return { ok: false, code: 'unavailable' };

  const results: MerchantInboxSearchResult[] = [];
  for (const raw of rows.slice(0, 50)) {
    const conversation = projectMerchantInboxConversation(raw, binding.inboxId);
    if (conversation) results.push({ conversation, snippet: snippetOf(raw) });
  }
  // As with the list: any non-empty provider page may have a successor.
  return { ok: true, results, hasMore: rows.length > 0 };
}
