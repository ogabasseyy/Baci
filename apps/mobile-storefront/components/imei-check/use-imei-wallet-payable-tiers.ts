import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useEffect, useState } from 'react';
import { fetchImeiWalletPayableTiers } from '@/lib/imei-wallet-payable-tiers';

export const PAYABLE_TIERS_TIMEOUT_MS = 8000;

/**
 * The checks the server can bill to the PiggyVest wallet (walk 2026-11-15,
 * M1). Asked only while paying from it is on. 'loading' while a read is in
 * flight (nothing is offered yet, so a switch never shows another device's
 * list); null when the read fails or the server doesn't say, so the app
 * keeps its own rule and the server still refuses what it can't bill.
 */
export function useImeiWalletPayableTiers({
  apiBaseUrl,
  canPay,
  device,
}: {
  apiBaseUrl: string;
  canPay: boolean;
  device: ImeiDeviceCategory;
}) {
  // The answer is kept with the request it belongs to, so the render right
  // after a device switch never shows another device's list (CodeRabbit).
  const requestKey = `${apiBaseUrl}|${device}`;
  const [answer, setAnswer] = useState<{
    key: string;
    tiers: readonly ImeiServiceTierKey[] | null;
  } | null>(null);
  useEffect(() => {
    if (!canPay) return;
    const controller = new AbortController();
    let current = true;
    const settle = (tiers: readonly ImeiServiceTierKey[] | null) => {
      if (current) setAnswer({ key: requestKey, tiers });
      current = false;
    };
    // Verify waits while this loads, so a slow server falls back to the
    // app rule instead of holding the button forever.
    const giveUp = setTimeout(() => {
      settle(null);
      controller.abort();
    }, PAYABLE_TIERS_TIMEOUT_MS);
    fetchImeiWalletPayableTiers({
      device,
      apiBaseUrl,
      signal: controller.signal,
    })
      .then(settle, () => settle(null))
      .finally(() => clearTimeout(giveUp));
    return () => {
      current = false;
      clearTimeout(giveUp);
      controller.abort();
    };
  }, [apiBaseUrl, canPay, device, requestKey]);
  if (!canPay) return null;
  return answer?.key === requestKey ? answer.tiers : 'loading';
}
