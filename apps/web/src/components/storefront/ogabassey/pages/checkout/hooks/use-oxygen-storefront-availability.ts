'use client';

import { useEffect, useState } from 'react';

interface AdmissionInput {
  customerId: string | null | undefined;
  merchantId: string | null | undefined;
  revision: number;
  authenticated: boolean;
}

/** A fail-closed display hint, tied to both the merchant and auth revision. */
export function useOxygenStorefrontAvailability(input: AdmissionInput): boolean {
  const { customerId, merchantId, revision, authenticated } = input;
  const key = authenticated && customerId && merchantId
    ? `${customerId}:${merchantId}:${revision}` : null;
  const [result, setResult] = useState<{ key: string; available: boolean } | null>(null);
  useEffect(() => {
    if (!key || !merchantId) return;
    const controller = new AbortController();
    void fetch(`/api/payments/oxygen/storefront-availability?merchantId=${encodeURIComponent(merchantId)}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => response.ok && (await response.json()).available === true)
      .catch(() => false)
      .then((available) => {
        if (!controller.signal.aborted) setResult({ key, available });
      });
    return () => controller.abort();
  }, [key, merchantId]);
  return key !== null && result?.key === key && result.available;
}
