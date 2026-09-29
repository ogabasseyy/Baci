'use client';

import { useEffect, useState } from 'react';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

type AvailabilityResponse = { available: boolean; reason: string };

export function useRedvaultPaymentAvailability(
  merchantId?: string | null,
  productId?: string | null,
  authKey?: string | null
) {
  const requestKey = `${merchantId ?? ''}:${productId ?? ''}:${authKey ?? ''}`;
  const [availability, setAvailability] = useState<{
    key: string;
    value: AvailabilityResponse;
  }>({
    key: '',
    value: { available: false, reason: 'unavailable' },
  });

  useEffect(() => {
    if (merchantId !== OGABASSEY_MERCHANT_ID) {
      setAvailability({
        key: requestKey,
        value: { available: false, reason: 'merchant_unavailable' },
      });
      return;
    }

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
          setAvailability({ key: requestKey, value: result });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAvailability({
            key: requestKey,
            value: { available: false, reason: 'unavailable' },
          });
        }
      });

    return () => controller.abort();
  }, [merchantId, productId, authKey, requestKey]);

  return merchantId === OGABASSEY_MERCHANT_ID
    ? availability.key === requestKey
      ? availability.value
      : { available: false, reason: 'unavailable' }
    : { available: false, reason: 'merchant_unavailable' };
}
