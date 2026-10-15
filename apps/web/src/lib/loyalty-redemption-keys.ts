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
// the winner's key instead of minting a second one. Where locks are
// unavailable (or throw), minting instead writes a short-lived claim
// record and adopts the winning claim after a bounded wait, so two
// tabs still converge on one key; only if storage itself is broken
// does the sequence fall back to a lone synchronous mint.
const STORAGE_PREFIX = 'loyalty-redeem-key:';

// Fallback cross-tab claim (used when Web Locks is unavailable): a tab
// stakes a random claim token, then polls briefly; the lowest live
// token wins and losers adopt the winner's minted key from storage.
// Claims expire so a crashed claimant cannot block the intent.
const CLAIM_POLL_INTERVAL_MS = 25;
const CLAIM_POLL_ATTEMPTS = 20;
const CLAIM_TTL_MS = 10_000;

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

interface MintClaim {
  token: string;
  expiresAt: number;
}

function readClaim(intent: string): MintClaim | null {
  const raw = readStored(`${intent}:claim`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MintClaim>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > Date.now()
    ) {
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    }
  } catch {
    // A malformed claim is treated as expired and overwritten.
  }
  return null;
}

function writeClaim(intent: string, claim: MintClaim): void {
  writeStored(`${intent}:claim`, JSON.stringify(claim));
}

function clearClaim(intent: string, token: string): void {
  // Token-checked: never remove a newer claimant's record.
  if (readClaim(intent)?.token === token) removeStored(`${intent}:claim`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Web Locks is unavailable or threw: coordinate the first mint through
// a storage claim so concurrent tabs still converge on one key. Every
// claimant stakes a token; after each poll the lowest live token owns
// the mint, and once the key lands in storage every tab adopts it. A
// claimant whose token loses simply waits for the winner's key.
async function coordinatedMint(intent: string): Promise<string> {
  const existing = readStored(intent);
  if (existing) return existing;
  const token = crypto.randomUUID();
  const prior = readClaim(intent);
  if (!prior || token < prior.token) {
    writeClaim(intent, { token, expiresAt: Date.now() + CLAIM_TTL_MS });
  }
  for (let attempt = 0; attempt < CLAIM_POLL_ATTEMPTS; attempt++) {
    const stored = readStored(intent);
    if (stored) {
      clearClaim(intent, token);
      return stored;
    }
    const claim = readClaim(intent);
    if (!claim || claim.token === token) {
      const minted = mintKey(intent);
      clearClaim(intent, token);
      return minted;
    }
    if (token < claim.token) {
      writeClaim(intent, { token, expiresAt: Date.now() + CLAIM_TTL_MS });
    }
    await delay(CLAIM_POLL_INTERVAL_MS);
  }
  // No winner published within the window (e.g. storage writes are
  // failing): resolve locally rather than block redemption forever.
  const stored = readStored(intent);
  if (stored) return stored;
  const minted = mintKey(intent);
  clearClaim(intent, token);
  return minted;
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
  if (!locks) {
    // No Web Locks: converge through the storage-claim protocol.
    const coordinated = await coordinatedMint(intent);
    const reconciled = readStored(intent);
    if (reconciled) {
      keysByIntent.set(intent, reconciled);
      persistedIntents.add(intent);
      return reconciled;
    }
    return coordinated;
  }
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
    // Locks threw mid-flight: same storage-claim protocol as no locks.
    const coordinated = await coordinatedMint(intent);
    const reconciled = readStored(intent);
    if (reconciled) {
      keysByIntent.set(intent, reconciled);
      persistedIntents.add(intent);
      return reconciled;
    }
    return coordinated;
  }
}

function clearKeyForReward(
  merchantId: string,
  customerId: string,
  rewardId: string,
  completedKey?: string
): void {
  const intent = storageKey(merchantId, customerId, rewardId);
  // Compare-and-clear when the caller names the key it completed: two
  // tabs can share one stored key, and the slower tab's success must
  // not delete a newer key a retry already minted for the next
  // redemption (clearing it would force a third key and double-spend).
  // Callers that omit the key keep the plain clear.
  if (completedKey !== undefined) {
    const current = readStored(intent) ?? keysByIntent.get(intent);
    if (current !== completedKey) return;
  }
  keysByIntent.delete(intent);
  persistedIntents.delete(intent);
  removeStored(intent);
}

export const redemptionIdempotencyKeys = {
  forReward: keyForReward,
  clearForReward: clearKeyForReward,
};
