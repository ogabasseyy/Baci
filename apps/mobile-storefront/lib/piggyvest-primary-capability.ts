import { useEffect, useState } from 'react';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
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

const inflight = new Map<string, Promise<boolean>>();

export function clearPiggyvestPrimaryCapabilityCache() {
  clearObservedPiggyvestPrimaryCapability();
  inflight.clear();
}

/**
 * Confirms with the server that the primary wallet capability is enabled
 * for this merchant. Probes every merchant so rollout is server-driven;
 * resolves false only on the server's explicit not-ready signal, while any
 * other failure rejects so callers never misroute money on an ambiguous
 * error.
 */
export async function getPiggyvestPrimaryCapability(
  merchantId: string
): Promise<boolean> {
  const cached = readObservedPiggyvestPrimaryCapability(merchantId);
  if (cached !== null) return cached;
  const pending = inflight.get(merchantId);
  if (pending) return pending;
  const probe = (async () => {
    try {
      await piggyvestPrimaryWalletApi.read(merchantId);
      observePiggyvestPrimaryCapability(merchantId, true);
      return true;
    } catch (error) {
      if (!isPrimaryWalletNotReady(error)) throw error;
      // Feature-scoped codes resolve false once without caching: only the
      // base verdict describes the whole merchant integration.
      if (isBasePrimaryNotReady(error))
        observePiggyvestPrimaryCapability(merchantId, false);
      return false;
    } finally {
      inflight.delete(merchantId);
    }
  })();
  inflight.set(merchantId, probe);
  return await probe;
}

/**
 * React binding for the primary capability probe. Pilot merchants fail open
 * while unknown (null reads as enabled; async actions re-check at call
 * time). Every other merchant fails closed until the server positively
 * confirms primary, so rollout stays server-driven without flashing
 * primary UI at unconfigured merchants.
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
    const pilot = isPiggyvestPrimaryMerchant(merchantId);
    const observed = readObservedPiggyvestPrimaryCapability(merchantId);
    setAvailable(pilot ? observed : observed === true);
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
