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
