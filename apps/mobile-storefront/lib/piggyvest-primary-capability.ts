import { useEffect, useState } from 'react';
import {
  clearObservedPiggyvestPrimaryCapability,
  NEGATIVE_CAPABILITY_TTL_MS,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

/**
 * Server-delivered "primary is not configured" signals. Every code here is
 * returned only when the server's primary runtime is missing or bound to a
 * different merchant — never for transient failures — so the mobile app may
 * treat it as authoritative permission to use the working legacy flows
 * for that call. Only the base code is cacheable (see below): the
 * feature codes describe independently configured runtimes.
 */
const PRIMARY_NOT_READY_CODES = new Set([
  'PIGGYVEST_NOT_READY',
  'PRIMARY_CARD_NOT_READY',
  'SAVINGS_NOT_READY',
]);

export function isPrimaryWalletNotReady(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    PRIMARY_NOT_READY_CODES.has((error as { code: string }).code)
  );
}

function isBasePrimaryNotReady(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'PIGGYVEST_NOT_READY'
  );
}

function isProfileVerificationRequired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'PROFILE_VERIFICATION_REQUIRED'
  );
}

/**
 * Rolls back the cached verdict when an authoritative NOT_READY arrives
 * over a non-probe path (connect/reserve/status mutations). A cached
 * positive verdict otherwise survives the server's explicit "unconfigured"
 * signal, so every later sync gate keeps routing into primary and each new
 * attempt earns another 503. Returns true when the error is authoritative
 * (the caller falls back to the working legacy flow); transient and
 * foreign failures leave the cache untouched and return false.
 *
 * Only the base PIGGYVEST_NOT_READY verdict is written to the shared
 * merchant-wide cache: the feature codes (PRIMARY_CARD_NOT_READY,
 * SAVINGS_NOT_READY) describe independently configured runtimes, so a
 * card-only outage must not reroute savings contributions through legacy
 * (or vice versa). Feature codes fall back once without caching.
 */
export function rollbackObservedCapabilityOnNotReady(
  merchantId: string | null | undefined,
  error: unknown
): boolean {
  if (!isPrimaryWalletNotReady(error)) return false;
  if (merchantId && isBasePrimaryNotReady(error))
    observePiggyvestPrimaryCapability(merchantId, false);
  return true;
}

export interface PiggyvestPrimaryCapabilitySnapshot {
  available: boolean;
  /**
   * The funding-account snapshot, present only when this call performed
   * the network probe. Lets callers reuse the already-fetched account
   * instead of re-reading it (null = primary enabled, none provisioned
   * yet). Absent on cached verdicts, where no fetch happened.
   */
  account?: Awaited<
    ReturnType<typeof piggyvestPrimaryWalletApi.read>
  >['account'];
}

const inflight = new Map<string, Promise<PiggyvestPrimaryCapabilitySnapshot>>();

export function clearPiggyvestPrimaryCapabilityCache() {
  clearObservedPiggyvestPrimaryCapability();
  inflight.clear();
}

/**
 * Confirms with the server that the primary wallet capability is enabled
 * for this merchant, keeping the probe's funding-account snapshot so the
 * caller can reuse it instead of re-reading the same account. Probes
 * every merchant so rollout is server-driven; resolves unavailable only
 * on the server's explicit not-ready signal, while any other failure
 * rejects so callers never misroute money on an ambiguous error.
 *
 * The in-flight probe is scoped to (merchant, user): the verdict is
 * merchant-wide, but the snapshot carries the authenticated caller's
 * funding account, so a merchant-keyed promise would leak user A's bank
 * account to user B's wallet load after an account switch. Concurrent
 * loads for the same user still share one probe.
 */
export async function getPiggyvestPrimaryCapabilitySnapshot(
  merchantId: string,
  userId: string
): Promise<PiggyvestPrimaryCapabilitySnapshot> {
  const cached = readObservedPiggyvestPrimaryCapability(merchantId);
  if (cached !== null) return { available: cached };
  return await sharedProbe(`${merchantId}\n${userId}`, merchantId);
}

/**
 * Boolean view of the capability probe for callers that only gate on the
 * verdict and never need the funding account itself. The verdict carries
 * no account data, so the merchant-wide promise is safe to share across
 * users — but it never shares with snapshot-bearing probes.
 */
export async function getPiggyvestPrimaryCapability(
  merchantId: string
): Promise<boolean> {
  const cached = readObservedPiggyvestPrimaryCapability(merchantId);
  if (cached !== null) return cached;
  return (await sharedProbe(`${merchantId}\nverdict`, merchantId)).available;
}

async function sharedProbe(
  scopeKey: string,
  merchantId: string
): Promise<PiggyvestPrimaryCapabilitySnapshot> {
  const pending = inflight.get(scopeKey);
  if (pending) return pending;
  // Assigned synchronously below; the closure only runs after that.
  let probe!: Promise<PiggyvestPrimaryCapabilitySnapshot>;
  probe = (async () => {
    try {
      const snapshot = await piggyvestPrimaryWalletApi.read(merchantId);
      observePiggyvestPrimaryCapability(merchantId, true);
      return { available: true, account: snapshot.account };
    } catch (error) {
      if (isProfileVerificationRequired(error)) {
        // The wallet GET emits this 409 only after the runtime check
        // passes, so it proves the merchant is primary-enabled even
        // though this customer's profile is incomplete. Record the
        // positive verdict: without it the hook stays unknown, the
        // funding controller waits on primaryVerdictPending, the phone
        // prompt never renders, and every probe repeats the same 409.
        observePiggyvestPrimaryCapability(merchantId, true);
        return { available: true };
      }
      if (!isPrimaryWalletNotReady(error)) throw error;
      // Feature-scoped codes resolve false once without caching: only the
      // base verdict describes the whole merchant integration.
      if (isBasePrimaryNotReady(error))
        observePiggyvestPrimaryCapability(merchantId, false);
      return { available: false };
    } finally {
      if (inflight.get(scopeKey) === probe) inflight.delete(scopeKey);
    }
  })();
  inflight.set(scopeKey, probe);
  return await probe;
}

/**
 * React binding for the primary capability probe. Every merchant reads
 * unknown (null) until the first verdict lands, so rollout stays
 * server-driven: consumers wait instead of flashing primary UI at
 * unconfigured merchants or minting legacy accounts a primary verdict
 * would orphan. Async actions re-check the verdict at call time.
 */
export function usePiggyvestPrimaryCapability(
  merchantId?: string | null
): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  // Bumped when a cached negative verdict expires so a mounted screen
  // reprobes: without it the hook would pin `false` (and the sync gates
  // would keep routing through legacy) until remount even after the
  // merchant is server-enabled mid-session.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!merchantId) {
      setAvailable(false);
      return;
    }
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const observed = readObservedPiggyvestPrimaryCapability(merchantId);
    // Unknown until the probe resolves for every merchant: a never-observed
    // non-pilot merchant must not start at `false` (legacy) or DVA creation
    // could route a primary-enabled merchant's deposits onto the legacy rail
    // before the first verdict lands. Consumers treat `null` as "wait".
    setAvailable(observed);
    void getPiggyvestPrimaryCapability(merchantId).then(
      (result) => {
        if (!active) return;
        setAvailable(result);
        if (result === false)
          refreshTimer = setTimeout(() => {
            if (active) setRevision((value) => value + 1);
          }, NEGATIVE_CAPABILITY_TTL_MS);
      },
      () => {
        // Ambiguous probe failure (timeout, network): stay unknown instead
        // of reporting false, so an observed merchant keeps its primary
        // routing and financial actions wait for a confirmed verdict
        // rather than misrouting through legacy — and reprobe so a
        // mounted screen recovers without remount.
        if (!active) return;
        setAvailable(null);
        refreshTimer = setTimeout(() => {
          if (active) setRevision((value) => value + 1);
        }, NEGATIVE_CAPABILITY_TTL_MS);
      }
    );
    return () => {
      active = false;
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  }, [merchantId, revision]);
  return available;
}
