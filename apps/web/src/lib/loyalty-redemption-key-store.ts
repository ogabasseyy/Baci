// Durable storage primitives for loyalty redemption idempotency
// keys (see loyalty-redemption-keys.ts for the protocol overview).

const STORAGE_PREFIX = 'loyalty-redeem-key:';

// Fallback cross-tab claim (used when Web Locks is unavailable): a tab
// stakes a random claim token, then polls briefly; the lowest live
// token wins and losers adopt the winner's minted key from storage.
// Claims expire so a crashed claimant cannot block the intent.
export function storageIsUsable(): boolean {
  // Private-mode / storage-disabled browsers throw or drop writes:
  // probing once up front keeps the claim protocol from sleeping
  // through its whole wait window on storage that can never answer.
  try {
    if (typeof localStorage === 'undefined') return false;
    const probe = `${STORAGE_PREFIX}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export const keysByIntent = new Map<string, string>();

// Intents whose key reached durable storage. Only those are subject to
// storage reconciliation on read: when storage later reads empty, the
// key was cleared (here or in another tab after its success), so the
// cached copy must not be reused.
export const persistedIntents = new Set<string>();

export function storageKey(
  merchantId: string,
  customerId: string,
  rewardId: string
): string {
  return `${STORAGE_PREFIX}${merchantId}:${customerId}:${rewardId}`;
}

export function readStored(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Durability is best-effort; the Map still dedupes this session.
  }
}

export function removeStored(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // The cleared Map entry already ends this intent's retries.
  }
}

export function mintKey(intent: string): string {
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
  const persisted = readStored(intent);
  if (persisted === fresh) {
    persistedIntents.add(intent);
    return fresh;
  }
  if (persisted) {
    // A simultaneous tab's key landed instead of ours: adopt the
    // durable winner rather than compete with it.
    keysByIntent.set(intent, persisted);
    persistedIntents.add(intent);
    return persisted;
  }
  // Fail closed: a key that exists only in this tab's memory dies on
  // reload, and a shopper retrying after a lost redemption response
  // would mint a second key and spend their points twice.
  keysByIntent.delete(intent);
  throw new Error(
    'Unable to save redemption recovery. Please enable browser storage and try again.'
  );
}
