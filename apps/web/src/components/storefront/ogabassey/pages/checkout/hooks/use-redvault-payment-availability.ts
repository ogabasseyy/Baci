'use client';

import { useEffect, useState } from 'react';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

type AvailabilityResponse = {
  available: boolean;
  reason: string;
  expiresAt?: number;
};

const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

function readExpiresAt(body: AvailabilityResponse): number | undefined {
  return typeof body.expiresAt === 'number' &&
    Number.isFinite(body.expiresAt)
    ? body.expiresAt
    : undefined;
}

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
  // Bumped when the pilot expiry passes (or the tab regains focus) so a
  // checkout left open past the short pilot window revalidates instead of
  // retaining its cached positive result.
  const [refreshNonce, setRefreshNonce] = useState(0);

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
        const expiresAt = readExpiresAt(body as AvailabilityResponse);
        return {
          available: true,
          reason: (body as AvailabilityResponse).reason,
          ...(expiresAt === undefined ? {} : { expiresAt }),
        };
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
  }, [merchantId, productId, authKey, requestKey, identityKey, refreshNonce]);

  const resolvedExpiresAt =
    availability.value.available === true
      ? readExpiresAt(availability.value)
      : undefined;

  useEffect(() => {
    // Revalidate exactly when the pilot window ends. An already-passed
    // expiry schedules nothing: the render gate below already fails
    // closed, and refetching here would loop when client and server
    // clocks disagree; the focus listener still heals that case.
    if (resolvedExpiresAt === undefined) return;
    const delay = resolvedExpiresAt - Date.now();
    if (!(delay > 0)) return;
    const timer = setTimeout(
      () => setRefreshNonce((nonce) => nonce + 1),
      Math.min(delay, MAX_TIMEOUT_DELAY_MS)
    );
    return () => clearTimeout(timer);
  }, [resolvedExpiresAt]);

  const stateAvailable = availability.value.available === true;
  useEffect(() => {
    // A backgrounded tab may sleep past the expiry with its timer
    // throttled; revalidate on focus so a stale positive result is never
    // retained. Gated on the cached state (not the gated render output)
    // so clock-skew false expiries self-heal as well.
    if (!stateAvailable || typeof window === 'undefined') return;
    const onFocus = () => setRefreshNonce((nonce) => nonce + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [stateAvailable]);

  if (merchantId !== OGABASSEY_MERCHANT_ID) {
    return { available: false, reason: 'merchant_unavailable' };
  }
  let resolved: AvailabilityResponse = {
    available: false,
    reason: 'unavailable',
  };
  if (availability.key === requestKey) {
    resolved = availability.value;
  } else if (
    availability.identity !== '' &&
    availability.identity === identityKey
  ) {
    resolved = availability.value;
  }
  // Fail closed at render time once the pilot window has passed, even
  // before the scheduled revalidation lands.
  const resolvedExpiry = readExpiresAt(resolved);
  if (
    resolved.available === true &&
    resolvedExpiry !== undefined &&
    resolvedExpiry <= Date.now()
  ) {
    return { available: false, reason: 'unavailable' };
  }
  return resolved;
}
