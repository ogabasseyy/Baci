import { useEffect, useState } from 'react';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

/**
 * Server-delivered "primary is not configured" signals. Every code here is
 * returned only when the server's primary runtime is missing or bound to a
 * different merchant — never for transient failures — so the mobile app may
 * treat it as authoritative permission to use the working legacy flows.
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
  useEffect(() => {
    if (!merchantId) {
      setAvailable(false);
      return;
    }
    let active = true;
    const pilot = isPiggyvestPrimaryMerchant(merchantId);
    const observed = readObservedPiggyvestPrimaryCapability(merchantId);
    setAvailable(pilot ? observed : observed === true);
    void getPiggyvestPrimaryCapability(merchantId).then(
      (result) => {
        if (active) setAvailable(result);
      },
      () => {
        if (active) setAvailable(pilot ? null : false);
      }
    );
    return () => {
      active = false;
    };
  }, [merchantId]);
  return available;
}
