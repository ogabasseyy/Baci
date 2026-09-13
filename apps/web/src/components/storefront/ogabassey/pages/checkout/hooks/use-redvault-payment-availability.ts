'use client';

import { useEffect, useState } from 'react';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

type AvailabilityResponse = { available: boolean; reason: string };

export function useRedvaultPaymentAvailability(merchantId?: string | null) {
  const [availability, setAvailability] = useState<AvailabilityResponse>({
    available: false,
    reason: 'unavailable',
  });

  useEffect(() => {
    if (merchantId !== OGABASSEY_MERCHANT_ID) {
      setAvailability({ available: false, reason: 'merchant_unavailable' });
      return;
    }

    const controller = new AbortController();
    fetch(`/api/payments/redvault/availability?merchant_id=${merchantId}`, {
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
        if (!controller.signal.aborted) setAvailability(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAvailability({ available: false, reason: 'unavailable' });
        }
      });

    return () => controller.abort();
  }, [merchantId]);

  return merchantId === OGABASSEY_MERCHANT_ID
    ? availability
    : { available: false, reason: 'merchant_unavailable' };
}
