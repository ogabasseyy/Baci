import type { ImeiAccessClient } from '@/lib/imei-access';
import {
  errorBody,
  findLookupByIdempotencyKey,
  json,
  mapExistingLookup,
  UUID_PATTERN,
} from './route-helpers';

type ReplayContext = Parameters<typeof mapExistingLookup>[1];

export async function claimImeiAttempt({
  access,
  context,
  requestedKey,
  previousLookupId,
  supportsRepeat,
}: {
  access: ImeiAccessClient;
  context: ReplayContext;
  requestedKey: string;
  previousLookupId?: string;
  supportsRepeat: boolean;
}) {
  const claim = await access.claimAttempt({
    tier: context.tier,
    imei_hash: context.imeiHash,
    idempotency_key: requestedKey,
    ...(previousLookupId ? { previous_lookup_id: previousLookupId } : {}),
  });
  if (
    claim.error ||
    !claim.data ||
    !UUID_PATTERN.test(claim.data.idempotency_key)
  ) {
    return {
      response: json(
        errorBody({
          code: 'IMEI_ATTEMPT_UNAVAILABLE',
          error: 'Unable to safely resume this check. Please try again.',
        }),
        503
      ),
      canonicalKey: null,
    };
  }
  const canonicalKey = claim.data.idempotency_key;
  const existing = await findLookupByIdempotencyKey(access, canonicalKey);
  if (!existing) return { response: null, canonicalKey };
  if (canonicalKey !== requestedKey && existing.status === 'completed') {
    return {
      response: json(
        {
          ...errorBody({
            code: 'PREVIOUS_REPORT_AVAILABLE',
            error: supportsRepeat
              ? 'A previous report is available. Open it in history, or press check again to order a fresh report.'
              : 'A previous report is available. Update your app or refresh this page to order a fresh report.',
          }),
          lookupId: existing.id,
        },
        409
      ),
      canonicalKey: null,
    };
  }
  return { response: mapExistingLookup(existing, context), canonicalKey: null };
}

/** Reconcile a same-key retry before returning a still-pending cached result. */
export async function reconcileExistingImeiAttempt({
  access,
  context,
  requestedKey,
  existing,
}: {
  access: ImeiAccessClient;
  context: ReplayContext;
  requestedKey: string;
  existing: NonNullable<Awaited<ReturnType<typeof findLookupByIdempotencyKey>>>;
}) {
  if (
    (existing.status === 'pending' ||
      existing.status === 'refund_pending' ||
      existing.status === 'failed_error') &&
    existing.customer_id === context.customerId &&
    existing.merchant_id === context.merchantId &&
    existing.tier === context.tier &&
    existing.imei_hash === context.imeiHash &&
    (existing.device_category ?? null) === (context.deviceCategory ?? null)
  ) {
    const claim = await access.claimAttempt({
      tier: context.tier,
      imei_hash: context.imeiHash,
      idempotency_key: requestedKey,
    });
    if (!claim.error) {
      const refreshed = await findLookupByIdempotencyKey(access, requestedKey);
      if (refreshed) return mapExistingLookup(refreshed, context);
    }
  }
  return mapExistingLookup(existing, context);
}
