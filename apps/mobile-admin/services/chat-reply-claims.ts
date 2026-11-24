import type { NotificationResponse } from 'expo-notifications';
import { asyncStorage } from '@/lib/storage';

const STORAGE_KEY = '@baci_chat_reply_handled';
/**
 * Claims kept in storage. Each is a short key, so this is small. Expo hands
 * back only the most recent notification response, so a replay can only ever
 * be of one of the latest replies; this many is far more than that needs.
 */
const KEEP_LAST = 500;

/** This session's claims: they win a race the storage read would lose. */
const claimedThisSession = new Set<string>();
/** Replies already answered on screen this launch (alerts, never stored). */
const shownThisLaunch = new Set<string>();

/** Adds a key, forgetting the oldest beyond the same cap storage uses. */
function remember(keys: Set<string>, key: string): void {
  keys.add(key);
  if (keys.size > KEEP_LAST) {
    const oldest = keys.values().next().value;
    if (oldest !== undefined) keys.delete(oldest);
  }
}

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

/**
 * The notification's id, the store and chat it names, and the text. Not its
 * date: the live listener and the "last response" read must give the same key,
 * and nothing proves they serialise the date alike. (The cost: the same words
 * sent twice from one notification count as one reply, which iOS and Android
 * clear after use.) The store and chat are in the key so that two chats can
 * never collide even if a notification id is ever reused.
 */
function responseKey(response: NotificationResponse): string {
  const { identifier, content } = response.notification.request;
  const data = (content?.data ?? {}) as Record<string, unknown>;
  const text = response.userText ?? '';
  return `${identifier}:${String(data.merchant_id ?? '')}:${String(
    data.conversation_id ?? ''
  )}:${text.length}:${fingerprint(text)}`;
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
 * `new`: first time, send it. `repeat`: already handled in this launch (the
 * live listener and the "last response" read both delivered it): do nothing.
 * `replay`: handled in an earlier launch, so it may or may not have been sent:
 * never send it again, but let the owner check the chat.
 */
export type ReplyClaim = 'new' | 'repeat' | 'replay';

/**
 * Claims one notification reply. The server has no idempotency key, so a
 * repeat would be a second customer-visible reply; the claim is therefore also
 * kept in storage (the last response can be read again after a restart) and
 * taken before sending: a reply is never sent twice, even if the app stops half
 * way through.
 */
export async function claimChatReply(
  response: NotificationResponse
): Promise<ReplyClaim> {
  const key = responseKey(response);
  if (claimedThisSession.has(key)) return 'repeat';
  // Synchronous, before any await: a second delivery in the same tick loses.
  remember(claimedThisSession, key);
  try {
    return await persistClaim(key);
  } catch {
    // Storage unavailable: the in-session claim above still holds.
    return 'new';
  }
}

/**
 * One storage update at a time: two different replies handled together would
 * otherwise both read the same list and the second write would drop the first
 * claim, letting that reply be sent again after a restart.
 */
let storageQueue: Promise<unknown> = Promise.resolve();

function persistClaim(key: string): Promise<ReplyClaim> {
  const run = storageQueue.then(async (): Promise<ReplyClaim> => {
    const stored = parseStored(await asyncStorage.getItem(STORAGE_KEY));
    if (stored.includes(key)) return 'replay';
    await asyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...stored, key].slice(-KEEP_LAST))
    );
    return 'new';
  });
  // The next update waits for this one, whether it worked or not.
  storageQueue = run.catch(() => undefined);
  return run;
}

/**
 * True the first time this launch sees a reply that sends nothing (empty, too
 * long, no store): the live listener and the "last response" read can both
 * deliver it, and the owner should be told once. Never stored, and never a
 * claim, so such a reply can not later be mistaken for one that was sent.
 */
export function firstSightThisLaunch(response: NotificationResponse): boolean {
  const key = responseKey(response);
  if (shownThisLaunch.has(key)) return false;
  remember(shownThisLaunch, key);
  return true;
}
