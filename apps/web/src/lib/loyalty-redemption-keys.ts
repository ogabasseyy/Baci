// Stable-per-intent idempotency keys for loyalty redemption.
//
// A timeout retry must reuse the key from the failed attempt (a fresh
// key per call would mint a second redemption), so keys persist per
// merchant/customer/reward until that intent redeems successfully. The
// module Map is a read-through cache; localStorage is the durable
// layer so a reload between a lost response and its retry replays
// instead of re-spending. Storage failures (SSR, private mode) degrade
// to Map-only rather than breaking redemption.
//
// First-write cross-tab races resolve to a single winner: when the
// Web Locks API is available, minting runs inside a per-intent lock
// and re-reads storage after acquiring it, so a tab that waited adopts
// the winner's key instead of minting a second one. Without locks the
// synchronous read-mint-store sequence is the fallback.
const STORAGE_PREFIX = 'loyalty-redeem-key:';

const keysByIntent = new Map<string, string>();

// Intents whose key reached durable storage. Only those are subject to
// storage reconciliation on read: when storage later reads empty, the
// key was cleared (here or in another tab after its success), so the
// cached copy must not be reused. Intents that never persisted (SSR,
// private mode) keep Map-only behavior.
const persistedIntents = new Set<string>();

interface LockManagerLike {
  request(name: string, callback: () => Promise<string>): Promise<string>;
}

function storageKey(
  merchantId: string,
  customerId: string,
  rewardId: string
): string {
  return `${STORAGE_PREFIX}${merchantId}:${customerId}:${rewardId}`;
}

function readStored(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Durability is best-effort; the Map still dedupes this session.
  }
}

function removeStored(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // The cleared Map entry already ends this intent's retries.
  }
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

function mintKey(intent: string): string {
  const cached = keysByIntent.get(intent);
  if (cached && !persistedIntents.has(intent)) return cached;
  // No stored key: either never minted, or a persisted key was cleared
  // after success (possibly by another tab — its Map clear cannot reach
  // this tab, so reconcile here instead of replaying a spent key).
  keysByIntent.delete(intent);
  persistedIntents.delete(intent);
  const fresh = crypto.randomUUID();
  keysByIntent.set(intent, fresh);
  writeStored(intent, fresh);
  if (readStored(intent) === fresh) persistedIntents.add(intent);
  return fresh;
}

async function keyForReward(
  merchantId: string,
  customerId: string,
  rewardId: string
): Promise<string> {
  const intent = storageKey(merchantId, customerId, rewardId);
  const stored = readStored(intent);
  if (stored) {
    keysByIntent.set(intent, stored);
    persistedIntents.add(intent);
    return stored;
  }
  const locks = lockManager();
  if (!locks) return mintKey(intent);
  try {
    return await locks.request(`${intent}:lock`, () => {
      // Re-read inside the lock: a tab that waited must adopt the
      // winner's stored key, never mint a competing one.
      const won = readStored(intent);
      if (won) {
        keysByIntent.set(intent, won);
        persistedIntents.add(intent);
        return Promise.resolve(won);
      }
      return Promise.resolve(mintKey(intent));
    });
  } catch {
    return mintKey(intent);
  }
}

function clearKeyForReward(
  merchantId: string,
  customerId: string,
  rewardId: string
): void {
  const intent = storageKey(merchantId, customerId, rewardId);
  keysByIntent.delete(intent);
  persistedIntents.delete(intent);
  removeStored(intent);
}

export const redemptionIdempotencyKeys = {
  forReward: keyForReward,
  clearForReward: clearKeyForReward,
};
