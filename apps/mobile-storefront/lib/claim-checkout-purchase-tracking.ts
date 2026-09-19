import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CheckoutTracking');

/**
 * Versioned claim-store layout. Version 1 was a bare JSON array of claim
 * strings; version 2 wraps the same entries in an envelope so upgrade
 * migrations are detectable on read.
 */
const CLAIM_STORE_VERSION = 2;
const COMPLETION_EVENT_NAME = 'payment_completed';

function filterClaimEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
}

function isVersionedClaimStore(value: unknown): value is {
  version: unknown;
  claims: unknown;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return 'version' in value && 'claims' in value;
}

function parseTrackedOrderIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (isVersionedClaimStore(parsed)) {
    return parsed.version === CLAIM_STORE_VERSION
      ? filterClaimEntries(parsed.claims)
      : [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  // One-time upgrade migration for the version-1 layout: pre-namespacing
  // checkouts recorded the native purchase under the bare order id, while
  // completion now claims `payment_completed:<orderId>`. Carry each bare id
  // forward as a completion claim so reopening a previously paid order (or
  // reaching its settlement screen) cannot emit Order Completed plus the
  // ad-platform purchase a second time.
  //
  // This runs on the unversioned layout only — never by matching bare ids
  // at claim time — because current code also stores bare ids for
  // order_created, and those must not suppress new completions. The first
  // successful write persists the versioned envelope, so later reads skip
  // this branch; until then the migration recomputes identically per read.
  const legacy = filterClaimEntries(parsed);
  const migrated = new Set(legacy);
  for (const entry of legacy) {
    if (!entry.includes(':')) {
      migrated.add(`${COMPLETION_EVENT_NAME}:${entry}`);
    }
  }
  return [...migrated];
}

function serializeTrackedOrderIds(claims: string[]): string {
  return JSON.stringify({ version: CLAIM_STORE_VERSION, claims });
}

// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// array and the last write silently drops the first claim (lost update),
// letting that event emit twice. The queue stays serialized on storage
// *settlement*, not on the caller's timeout: a write that started must land
// (or be rolled back) before the next claim reads, or the late write would
// clobber claims written after the queue was released.
// Claims this process successfully granted. A timed-out write that lands
// late overwrites the envelope with its stale value, erasing claims granted
// after the queue was released; the compensating rollback reconciles those
// back instead of only removing the late claim. Union is idempotent, so
// older grants kept in the stale value are unaffected.
const grantedClaims = new Set<string>();

let claimChain: Promise<void> = Promise.resolve();

const CLAIM_STORAGE_TIMEOUT_MS = 3000;
// Upper bound on how long one claim can hold the queue while its storage
// settles. Past this point the queue is released so later claims still get
// their turn; a write that lands afterwards is still compensated by the
// rollback attached to the raw write promise.
const MAX_QUEUE_HOLD_MS = 10_000;
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
// the late claim (best effort, bounded waits, failures logged) — but the
// stale write also overwrites the envelope, erasing claims granted after
// the queue was released. Reconcile those back from the in-process grant
// set, or the erased events would emit again on replay.
async function removeClaimAfterLateWrite(claim: string): Promise<void> {
  try {
    const stored = await readStoredClaims();
    if (stored === STORAGE_TIMEOUT) {
      return;
    }
    const reconciled = new Set(stored.filter((entry) => entry !== claim));
    for (const granted of grantedClaims) {
      reconciled.add(granted);
    }
    // Nothing to repair: the late claim never landed and no newer grants
    // exist. Skip the write so a healthy store is never rewritten here.
    if (
      reconciled.size === stored.length &&
      stored.every((entry) => reconciled.has(entry))
    ) {
      return;
    }
    const written = await Promise.race([
      AsyncStorage.setItem(
        CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
        serializeTrackedOrderIds([...reconciled])
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
  // the next claim — but never longer than the maximum hold, or a write
  // that never settles would wedge every later claim behind it.
  claimChain = run.then(
    ({ settled }) =>
      Promise.race([
        settled,
        new Promise<void>((resolve) => {
          setTimeout(resolve, MAX_QUEUE_HOLD_MS);
        }),
      ]),
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
      serializeTrackedOrderIds([...stored, claim])
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
    grantedClaims.add(claim);
    return { claimed: true, settled };
  } catch (error) {
    log.error('Failed to persist checkout purchase tracking claims:', error);
    return { claimed: false, settled };
  }
}
