import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useEffect, useState } from 'react';
import { fetchImeiWalletPayableTiers } from '@/lib/imei-wallet-payable-tiers';

/**
 * The checks the server can bill to the PiggyVest wallet (walk 2026-11-15,
 * M1). Asked only while paying from it is on; null until known, or when the
 * read fails, so the app keeps its own rule and the server still refuses
 * what it can't bill.
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
  const [payableTiers, setPayableTiers] = useState<
    readonly ImeiServiceTierKey[] | null
  >(null);
  useEffect(() => {
    if (!canPay) return;
    const controller = new AbortController();
    setPayableTiers(null);
    fetchImeiWalletPayableTiers({
      device,
      apiBaseUrl,
      signal: controller.signal,
    })
      .then((tiers) => {
        if (!controller.signal.aborted) setPayableTiers(tiers);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiBaseUrl, canPay, device]);
  return payableTiers;
}
