import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CheckoutTracking');

function parseTrackedOrderIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
  } catch {
    return [];
  }
}

// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// array and the last write silently drops the first claim (lost update),
// letting that event emit twice. The queue stays serialized on storage
// *settlement*, not on the caller's timeout: a write that started must land
// (or be rolled back) before the next claim reads, or the late write would
// clobber claims written after the queue was released.
let claimChain: Promise<void> = Promise.resolve();

const CLAIM_STORAGE_TIMEOUT_MS = 3000;
const STORAGE_TIMEOUT = Symbol('claim-storage-timeout');

function storageTimeout(): Promise<typeof STORAGE_TIMEOUT> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(STORAGE_TIMEOUT), CLAIM_STORAGE_TIMEOUT_MS);
  });
}

async function readStoredClaims(): Promise<string[] | typeof STORAGE_TIMEOUT> {
  const raw = await Promise.race([
    AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY),
    storageTimeout(),
  ]);
  if (raw === STORAGE_TIMEOUT) {
    return STORAGE_TIMEOUT;
  }
  return parseTrackedOrderIds(raw);
}

// A write that lands after its caller already timed out must not leave a
// phantom claim: the caller suppressed the analytics event, so a replay
// would see the persisted claim and skip the event forever. Remove exactly
// the late claim (best effort, bounded waits, failures logged).
async function removeClaimAfterLateWrite(claim: string): Promise<void> {
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT || !stored.includes(claim)) {
      return;
    }
    const written = await Promise.race([
      AsyncStorage.setItem(
        CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
        JSON.stringify(stored.filter((entry) => entry !== claim))
      ).then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking claim rollback timed out.');
    }
  } catch (error) {
    log.error('Failed to roll back late checkout purchase claim:', error);
  }
}

export function claimCheckoutPurchaseTracking(
  orderId: string,
  eventName = 'purchase'
): Promise<boolean> {
  const run = claimChain.then(() => performClaim(orderId, eventName));
  // performClaim never rejects, so the chain always advances; it advances
  // on storage settlement so a started-but-timed-out write cannot clobber
  // the next claim.
  claimChain = run.then(
    ({ settled }) => settled,
    () => undefined
  );
  return run.then(
    ({ claimed }) => claimed,
    () => false
  );
}

async function performClaim(
  orderId: string,
  eventName: string
): Promise<{ claimed: boolean; settled: Promise<void> }> {
  const settled = Promise.resolve();
  if (!orderId) {
    return { claimed: false, settled };
  }
  try {
    // A wedged native store must not stall the checkout flow: bound every
    // storage operation and treat a timeout as unavailable (skip the
    // emission, let navigation proceed) rather than queueing forever.
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      log.error('Checkout purchase tracking store read timed out.');
      return { claimed: false, settled };
    }
    const claim =
      eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
    if (stored.includes(claim)) {
      return { claimed: false, settled };
    }
    const write = AsyncStorage.setItem(
      CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
      JSON.stringify([...stored, claim])
    );
    const written = await Promise.race([
      write.then(() => true as const),
      storageTimeout(),
    ]);
    if (written === STORAGE_TIMEOUT) {
      // The caller gets its answer now, but the queue stays serialized
      // until this write settles, and a late success is compensated so no
      // phantom claim suppresses the replay.
      log.error('Checkout purchase tracking store write timed out.');
      return {
        claimed: false,
        settled: write.then(
          () => removeClaimAfterLateWrite(claim),
          () => undefined
        ),
      };
    }
    return { claimed: true, settled };
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return { claimed: false, settled };
  }
}
