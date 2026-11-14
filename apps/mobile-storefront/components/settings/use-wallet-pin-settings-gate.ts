import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { fetchWalletPinStatus } from '@/lib/wallet-pin-api';
import type { WalletPinSchemas } from '@/schemas/wallet-pin';
import { useAuthStore } from '@/stores/auth-store';

export type WalletPinStatus = z.infer<typeof WalletPinSchemas.status>;
export type WalletPinSettingsGate = {
  state: 'checking' | 'ready' | 'off';
  status: WalletPinStatus | null;
  /** Re-reads the PIN status; the settings UI stays visible meanwhile. */
  refresh: () => void;
};

type Result = {
  key: string;
  state: 'ready' | 'off';
  status: WalletPinStatus | null;
};

/**
 * Decides whether any wallet PIN settings UI may show. Every call is pinned to
 * the signed-in user, and an answer that arrives after an account switch is
 * dropped. Any rejection or unexpected value means "off": customers on the
 * legacy wallet never see PIN settings.
 */
export function useWalletPinSettingsGate(): WalletPinSettingsGate {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const storeMerchantId = useAuthStore((s) => s.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const [result, setResult] = useState<Result | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = userId && merchantId ? `${userId}|${merchantId}` : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce re-runs the read on refresh()
  useEffect(() => {
    if (!userId || !merchantId || !key) return;
    let current = true;
    const done = (next: Omit<Result, 'key'>) => {
      if (current) setResult({ key, ...next });
    };
    Promise.all([
      piggyvestPrimaryWalletApi.read(merchantId, userId),
      fetchWalletPinStatus(userId),
    ])
      .then(([snapshot, status]) => {
        const ready =
          snapshot.provisioningStatus === 'ready' &&
          snapshot.account !== null &&
          status.primary &&
          status.available;
        done(
          ready ? { state: 'ready', status } : { state: 'off', status: null }
        );
      })
      .catch(() => done({ state: 'off', status: null }));
    return () => {
      current = false;
    };
  }, [userId, merchantId, key, nonce]);

  const refresh = () => setNonce((n) => n + 1);
  if (!key) return { state: 'off', status: null, refresh };
  if (result?.key !== key) return { state: 'checking', status: null, refresh };
  return { state: result.state, status: result.status, refresh };
}
