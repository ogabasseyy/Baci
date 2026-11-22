import 'server-only';

import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { INBOX_SNIPPET_MAX_LENGTH } from '@/schemas/merchant-inbox-manage';
import {
  failure,
  getMerchantInboxConversation,
  type MerchantInboxFailure,
  providerGet,
} from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';

export type MerchantInboxSearchResult = {
  conversation: MerchantInboxConversation;
  /** The shopper's matching words, shortened; null when a name or contact matched. */
  snippet: string | null;
};

/** Most matches shown per page; each is read in full, so this stays small. */
const MAX_HITS_PER_PAGE = 20;
const HYDRATE_CONCURRENCY = 5;
const INCOMING = 0;

type Hit = { id: number; snippet: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const positiveId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;

/**
 * The chat engine has two searches and neither returns the list's shape: rows
 * carry a nested `inbox.id` and `contact.name` and no status. They only name
 * the matching conversations; each is then read in full (which also proves it
 * belongs to the bound inbox) before it is shown.
 */
function rowInbox(row: Record<string, unknown>): number | null {
  return isRecord(row.inbox) ? positiveId(row.inbox.id) : null;
}

/** Name, email, phone and id matches: `/search/conversations`, account-wide. */
async function searchByContact(
  binding: MerchantInboxBinding,
  input: { q: string; page: number }
): Promise<{ ok: true; rows: number; hits: Hit[] } | MerchantInboxFailure> {
  const response = await providerGet(binding, '/search/conversations', {
    q: input.q,
    page: String(input.page),
  });
  if (!response.ok) return failure(response);
  const payload = isRecord(response.body) ? response.body.payload : null;
  const rows = isRecord(payload) ? payload.conversations : null;
  if (!Array.isArray(rows)) return { ok: false, code: 'unavailable' };

  const hits: Hit[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = positiveId(row.id);
    // The search spans every inbox of the account: keep only this store's.
    if (id && rowInbox(row) === binding.inboxId)
      hits.push({ id, snippet: null });
  }
  return { ok: true, rows: rows.length, hits };
}

/**
 * Only the shopper's own words become a snippet. Staff private notes are
 * outgoing messages the search row cannot tell apart from public replies, so
 * no outgoing text is ever quoted.
 */
function shopperSnippet(
  row: Record<string, unknown>,
  q: string
): string | null {
  if (!Array.isArray(row.messages)) return null;
  const words: string[] = [];
  for (const message of row.messages) {
    if (!isRecord(message) || message.message_type !== INCOMING) continue;
    if (typeof message.content !== 'string') continue;
    const text = message.content.replace(/\s+/g, ' ').trim();
    if (text) words.push(text);
  }
  const needle = q.toLowerCase();
  const best = words.find((text) => text.toLowerCase().includes(needle));
  return (best ?? words[0] ?? null)?.slice(0, INBOX_SNIPPET_MAX_LENGTH) ?? null;
}

/** Message-text matches: `/conversations/search`, limited to the bound inbox. */
async function searchByMessage(
  binding: MerchantInboxBinding,
  input: { q: string; page: number }
): Promise<{ ok: true; rows: number; hits: Hit[] } | MerchantInboxFailure> {
  const response = await providerGet(binding, '/conversations/search', {
    q: input.q,
    page: String(input.page),
    inbox_id: String(binding.inboxId),
  });
  if (!response.ok) return failure(response);
  const rows = isRecord(response.body) ? response.body.payload : null;
  if (!Array.isArray(rows)) return { ok: false, code: 'unavailable' };

  const hits: Hit[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = positiveId(row.id);
    // The request is already limited to this inbox; the row must agree.
    if (id && rowInbox(row) === binding.inboxId) {
      hits.push({ id, snippet: shopperSnippet(row, input.q) });
    }
  }
  return { ok: true, rows: rows.length, hits };
}

async function readInChunks(
  binding: MerchantInboxBinding,
  hits: Hit[]
): Promise<MerchantInboxSearchResult[]> {
  const results: MerchantInboxSearchResult[] = [];
  for (let start = 0; start < hits.length; start += HYDRATE_CONCURRENCY) {
    const chunk = hits.slice(start, start + HYDRATE_CONCURRENCY);
    const owned = await Promise.all(
      chunk.map((hit) => getMerchantInboxConversation(binding, hit.id))
    );
    owned.forEach((read, index) => {
      if (read.ok) {
        results.push({
          conversation: read.conversation,
          snippet: chunk[index].snippet,
        });
      }
    });
  }
  return results;
}

/**
 * Searches the bound inbox by shopper name, contact, order or chat number and
 * by what the shopper wrote. Either search may fail alone; both failing is an
 * error. Rows from other inboxes are dropped before anything is read, and
 * every match is read through the inbox-ownership check before it is returned.
 */
export async function searchMerchantInboxConversations(
  binding: MerchantInboxBinding,
  input: { q: string; page: number }
): Promise<
  | { ok: true; results: MerchantInboxSearchResult[]; hasMore: boolean }
  | MerchantInboxFailure
> {
  const [byContact, byMessage] = await Promise.all([
    searchByContact(binding, input),
    searchByMessage(binding, input),
  ]);
  if (!byContact.ok && !byMessage.ok) return byMessage;

  const merged = new Map<number, Hit>();
  for (const hit of [
    ...(byMessage.ok ? byMessage.hits : []),
    ...(byContact.ok ? byContact.hits : []),
  ]) {
    const known = merged.get(hit.id);
    if (!known) merged.set(hit.id, hit);
    else if (!known.snippet && hit.snippet) known.snippet = hit.snippet;
  }

  const hits = [...merged.values()].slice(0, MAX_HITS_PER_PAGE);
  const results = await readInChunks(binding, hits);
  // Every match failed to load: the engine is unwell, not "no results".
  if (hits.length > 0 && results.length === 0) {
    return { ok: false, code: 'unavailable' };
  }
  results.sort(
    (a, b) =>
      (b.conversation.lastActivityAt
        ? Date.parse(b.conversation.lastActivityAt)
        : 0) -
      (a.conversation.lastActivityAt
        ? Date.parse(a.conversation.lastActivityAt)
        : 0)
  );
  // As with the list: any non-empty provider page may have a successor, so a
  // page of other stores' chats (no hits here) never ends the search early.
  const rows =
    (byContact.ok ? byContact.rows : 0) + (byMessage.ok ? byMessage.rows : 0);
  return { ok: true, results, hasMore: rows > 0 };
}
