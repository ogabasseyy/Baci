// Stable-per-intent idempotency keys for loyalty redemption.
//
// A timeout retry must reuse the key from the failed attempt (a fresh
// key per call would mint a second redemption), so keys persist per
// merchant/customer/reward until that intent redeems successfully. The
// module Map is a read-through cache; localStorage is the durable
// layer so a reload between a lost response and its retry replays
// instead of re-spending. Minting fails closed when the key cannot be
// persisted: a memory-only key would vanish on reload and a retry
// would mint a second key, spending the shopper's points twice.
//
// First-write cross-tab races resolve to a single winner: when the
// Web Locks API is available, minting runs inside a per-intent lock
// and re-reads storage after acquiring it, so a tab that waited adopts
// the winner's key instead of minting a second one. Where locks are
// unavailable (or throw), minting instead writes a short-lived claim
// record and adopts the winning claim after a bounded wait, so two
// tabs still converge on one key; only if storage itself is broken
// does the sequence fall back to a lone synchronous mint.
import {
  keysByIntent,
  mintKey,
  persistedIntents,
  readStored,
  removeStored,
  storageKey,
} from './loyalty-redemption-key-store';
import { coordinatedMint } from './loyalty-redemption-keys-coordinated';

interface LockManagerLike {
  request(name: string, callback: () => Promise<string>): Promise<string>;
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
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
