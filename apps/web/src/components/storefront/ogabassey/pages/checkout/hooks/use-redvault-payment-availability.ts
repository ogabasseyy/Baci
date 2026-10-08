'use client';

import { useEffect, useState } from 'react';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

type AvailabilityResponse = { available: boolean; reason: string };

export function useRedvaultPaymentAvailability(
  merchantId?: string | null,
  productId?: string | null,
  authKey?: string | null,
  sessionIndependentKey?: string | null
) {
  const requestKey = `${merchantId ?? ''}:${productId ?? ''}:${authKey ?? ''}`;
  // Identity excludes routine session churn (status/revision): while a
  // refetch for the SAME identity is in flight, keep serving the last
  // resolved value instead of flashing unavailable (which clears an
  // already-selected method). Identity changes (account, cart, merchant,
  // product) still fail closed until the fresh result lands. Without an
  // explicit identity the hook stays strict, as before.
  const identityKey =
    sessionIndependentKey == null
      ? requestKey
      : `${merchantId ?? ''}:${productId ?? ''}:${sessionIndependentKey}`;
  const [availability, setAvailability] = useState<{
    key: string;
    identity: string;
    value: AvailabilityResponse;
  }>({
    key: '',
    identity: '',
    value: { available: false, reason: 'unavailable' },
  });

  useEffect(() => {
    if (merchantId !== OGABASSEY_MERCHANT_ID) {
      setAvailability({
        key: requestKey,
        identity: identityKey,
        value: { available: false, reason: 'merchant_unavailable' },
      });
      return;
    }

    const fetchIdentity = identityKey;
    const controller = new AbortController();
    const query = new URLSearchParams({ merchant_id: merchantId });
    if (productId) query.set('product_id', productId);
    fetch(`/api/payments/redvault/availability?${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (
          !response.ok ||
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          (body as AvailabilityResponse).available !== true ||
          typeof (body as AvailabilityResponse).reason !== 'string'
        ) {
          return { available: false, reason: 'unavailable' };
        }
        return body as AvailabilityResponse;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setAvailability({
            key: requestKey,
            identity: fetchIdentity,
            value: result,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAvailability({
            key: requestKey,
            identity: fetchIdentity,
            value: { available: false, reason: 'unavailable' },
          });
        }
      });

    return () => controller.abort();
  }, [merchantId, productId, authKey, requestKey, identityKey]);

  if (merchantId !== OGABASSEY_MERCHANT_ID) {
    return { available: false, reason: 'merchant_unavailable' };
  }
  if (availability.key === requestKey) {
    return availability.value;
  }
  if (
    availability.identity !== '' &&
    availability.identity === identityKey
  ) {
    return availability.value;
  }
  return { available: false, reason: 'unavailable' };
}
