import type { NotificationResponse } from 'expo-notifications';
import { asyncStorage } from '@/lib/storage';

const STORAGE_KEY = '@baci_chat_reply_handled';
const KEEP_LAST = 50;

/** This session's claims: they win a race the storage read would lose. */
const claimedThisSession = new Set<string>();

/**
 * A short fingerprint of the text (cyrb53), so storage never holds what the
 * owner typed. Enough to tell two replies to one notification apart.
 */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function responseKey(response: NotificationResponse): string {
  const { identifier } = response.notification.request;
  const text = response.userText ?? '';
  return `${identifier}:${response.notification.date}:${text.length}:${fingerprint(text)}`;
}

function parseStored(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Claims one notification reply: true the first time it is seen, false for
 * every repeat. The same response can arrive twice in one launch (the live
 * listener and the "last response" read), and the last response can be read
 * again after the app restarts, so the claim is also kept in storage. The
 * server has no idempotency key, so a repeat would be a second customer-visible
 * reply. Claimed before sending: a reply is never sent twice, even if the app
 * stops half way through.
 */
export async function claimChatReply(
  response: NotificationResponse
): Promise<boolean> {
  const key = responseKey(response);
  if (claimedThisSession.has(key)) return false;
  // Synchronous, before any await: a second delivery in the same tick loses.
  claimedThisSession.add(key);
  try {
    const stored = parseStored(await asyncStorage.getItem(STORAGE_KEY));
    if (stored.includes(key)) return false;
    await asyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...stored, key].slice(-KEEP_LAST))
    );
  } catch {
    // Storage unavailable: the in-session claim above still holds.
  }
  return true;
}
