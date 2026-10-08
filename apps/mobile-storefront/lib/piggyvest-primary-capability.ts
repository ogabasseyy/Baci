import { useEffect, useState } from 'react';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
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

const CAPABILITY_TTL_MS = 60_000;
const capabilityCache = new Map<
  string,
  { available: boolean; observedAt: number }
>();
const inflight = new Map<string, Promise<boolean>>();

export function clearPiggyvestPrimaryCapabilityCache() {
  capabilityCache.clear();
  inflight.clear();
}

/**
 * Confirms with the server that the primary wallet capability is enabled
 * for this merchant. Resolves false only on the server's explicit
 * not-ready signal; any other failure rejects so callers never misroute
 * money on an ambiguous error.
 */
export async function getPiggyvestPrimaryCapability(
  merchantId: string
): Promise<boolean> {
  if (!isPiggyvestPrimaryMerchant(merchantId)) return false;
  const cached = capabilityCache.get(merchantId);
  if (cached && Date.now() - cached.observedAt < CAPABILITY_TTL_MS)
    return cached.available;
  const pending = inflight.get(merchantId);
  if (pending) return pending;
  const probe = (async () => {
    try {
      await piggyvestPrimaryWalletApi.read(merchantId);
      capabilityCache.set(merchantId, {
        available: true,
        observedAt: Date.now(),
      });
      return true;
    } catch (error) {
      if (!isPrimaryWalletNotReady(error)) throw error;
      capabilityCache.set(merchantId, {
        available: false,
        observedAt: Date.now(),
      });
      return false;
    } finally {
      inflight.delete(merchantId);
    }
  })();
  inflight.set(merchantId, probe);
  return await probe;
}

/**
 * React binding for the primary capability probe. Resolves to null while
 * unknown (treat as enabled to preserve the current UX; the async actions
 * re-check at call time), true when the server confirms primary, and false
 * when the server reports primary as not configured.
 */
export function usePiggyvestPrimaryCapability(
  merchantId?: string | null
): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!merchantId || !isPiggyvestPrimaryMerchant(merchantId)) {
      setAvailable(false);
      return;
    }
    let active = true;
    setAvailable(null);
    void getPiggyvestPrimaryCapability(merchantId).then(
      (result) => {
        if (active) setAvailable(result);
      },
      () => {
        if (active) setAvailable(null);
      }
    );
    return () => {
      active = false;
    };
  }, [merchantId]);
  return available;
}
