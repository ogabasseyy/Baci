import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { createLogger } from '@/lib/logger';

import {
  parseClaimLeases,
  parseTrackedOrderIds,
  serializeTrackedOrderIds,
} from './claim-store-codec';

export const log = createLogger('CheckoutTracking');

// Claims this process successfully granted. A timed-out write that lands
// late overwrites the envelope with its stale value, erasing claims granted
// after the queue was released; the compensating rollback reconciles those
// back instead of only removing the late claim. Union is idempotent, so
// older grants kept in the stale value are unaffected.
const grantedClaims = new Set<string>();

export function isClaimGranted(claim: string): boolean {
  return grantedClaims.has(claim);
}

export function addGrantedClaim(claim: string): void {
  grantedClaims.add(claim);
}

export function deleteGrantedClaim(claim: string): void {
  grantedClaims.delete(claim);
}

export function grantedClaimSnapshot(): string[] {
  return [...grantedClaims];
}

export interface ClaimLease {
  claimedAt: number;
  emittedAt?: number;
}

// A granted claim with no emission proof older than this is orphaned: the
// process died between grant and dispatch (or dispatch never ran), so a
// later poll may recover the claim instead of blocking on it forever.
// Rows predating leases have no record and stay held (emission presumed),
// and every successfully emitted claim stays held at any age.
export const CLAIM_LEASE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Claim leases live inside the versioned tracking envelope, so the grant
// and its lease persist in one write and load in one read: a second
// storage key would reintroduce the torn write the leases were added to
// close. Legacy envelopes (bare v1 arrays, or v2 without leases) parse as
// lease-less, which keeps pre-lease grants held (emission presumed).
export interface ClaimEnvelope {
  claims: string[];
  leases: Record<string, ClaimLease>;
}

export function parseClaimEnvelope(raw: string | null): ClaimEnvelope {
  return {
    claims: parseTrackedOrderIds(raw),
    leases: parseClaimLeases(raw),
  };
}

export function serializeClaimEnvelope(envelope: ClaimEnvelope): string {
  return serializeTrackedOrderIds(envelope.claims, envelope.leases);
}

export async function readClaimEnvelope(): Promise<
  ClaimEnvelope | typeof STORAGE_TIMEOUT
> {
  const raw = await Promise.race([
    AsyncStorage.getItem(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY),
    storageTimeout(),
  ]);
  if (raw === STORAGE_TIMEOUT) {
    return STORAGE_TIMEOUT;
  }
  return parseClaimEnvelope(raw);
}

// Persists an intended envelope merged with the in-process grant set, so a
// slow writer cannot erase claims granted after its value was computed.
// Only granted claims merge: a read can observe a not-yet-removed phantom,
// and merging observed-but-ungranted entries would resurrect it. Grants
// imply emission happened, so they must persist unconditionally. Leases
// are written only by their serialized granter, so they pass through.
export function persistClaimEnvelope(envelope: ClaimEnvelope): Promise<void> {
  const merged = new Set(envelope.claims);
  for (const granted of grantedClaims) {
    merged.add(granted);
  }
  // Repair leases clobbered by a stale snapshot: a granted claim is newer
  // truth than an orphaned lease (the claim was re-granted after that
  // lease aged, or emission already happened), so stamp it fresh instead
  // of letting the next poll mistake it for an orphan and double-emit.
  // Missing leases stay missing (legacy grants predate leases and stay
  // held), and fresh or emitted leases pass through untouched.
  const leases = { ...envelope.leases };
  const now = Date.now();
  for (const granted of grantedClaims) {
    if (merged.has(granted) && isOrphanedClaimLease(leases[granted], now)) {
      leases[granted] = { claimedAt: now };
    }
  }
  return AsyncStorage.setItem(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    serializeClaimEnvelope({ claims: [...merged], leases })
  );
}

export function isOrphanedClaimLease(
  lease: ClaimLease | undefined,
  now: number = Date.now()
): boolean {
  return (
    !!lease &&
    lease.emittedAt === undefined &&
    now - lease.claimedAt > CLAIM_LEASE_MAX_AGE_MS
  );
}

// Serializes concurrent claims so overlapping read-modify-write cycles
// cannot interleave: without it two claims in flight read the same stored
// envelope and the last write silently drops the first claim (lost update),
// letting that event emit twice.
let claimChain: Promise<void> = Promise.resolve();

export const CLAIM_STORAGE_TIMEOUT_MS = 3000;
// Upper bound on how long one claim can hold the queue while its storage
// settles. Past this point the queue is released so later claims still get
// their turn; a write that lands afterwards is still compensated by the
// rollback attached to the raw write promise.
export const MAX_QUEUE_HOLD_MS = 10_000;
export const STORAGE_TIMEOUT = Symbol('claim-storage-timeout');

export function storageTimeout(): Promise<typeof STORAGE_TIMEOUT> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(STORAGE_TIMEOUT), CLAIM_STORAGE_TIMEOUT_MS);
  });
}

export function claimKey(orderId: string, eventName: string): string {
  return eventName === 'purchase' ? orderId : `${eventName}:${orderId}`;
}

// Persists an intended envelope merged with the in-process grant set, so a
// slow writer cannot erase claims granted after its value was computed.
// Only granted claims are merged: a read can observe a not-yet-removed
// phantom, and merging observed-but-ungranted entries would resurrect it.
// Grants imply emission happened, so they must persist unconditionally.
/**
 * Enqueues one claim task behind every earlier claim, release, or retry
 * task. The queue advances on storage *settlement*, not on the caller's
 * timeout: a write that started must land (or be rolled back) before the
 * next task reads, or the late write would clobber entries written after
 * the queue was released — but never longer than the maximum hold, or a
 * write that never settles would wedge every later task behind it.
 */
export function serializeClaimTask<Result extends { settled: Promise<void> }>(
  task: () => Promise<Result>
): Promise<Result> {
  const run = claimChain.then(task);
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
  return run;
}
