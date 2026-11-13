import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { resolveRequestingOwnership } from '@/lib/vtu-checkout-ownership';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';

/**
 * Wallet-only checkout replay guards, moved out of the route (300-line
 * budget): a recorded key replays only for its own customer and storefront
 * (a stolen key must not replay cross-customer or cross-storefront; the
 * fingerprint omits merchant binding) and only with the same payload
 * (changed intent → 409, else the wrong recipient/amount is charged).
 * Returns the refusal, or null to carry on with the replay.
 */
export async function refuseForeignOrChangedReplay(input: {
  supabase: SupabaseClient;
  user: Parameters<typeof resolveRequestingOwnership>[1];
  merchantSlug: string;
  existing: ExistingIdempotencyRow;
  requestFingerprint: string;
}): Promise<NextResponse | null> {
  const { existing } = input;
  const requestingOwnership = await resolveRequestingOwnership(
    input.supabase,
    input.user,
    input.merchantSlug
  );
  if (
    !requestingOwnership.customerId ||
    existing.customer_id !== requestingOwnership.customerId
  ) {
    return NextResponse.json(
      { error: 'Idempotency-Key does not belong to this customer.' },
      { status: 400 }
    );
  }
  if (
    !requestingOwnership.merchantId ||
    existing.merchant_id !== requestingOwnership.merchantId
  ) {
    return NextResponse.json(
      { error: 'Idempotency-Key does not belong to this storefront.' },
      { status: 400 }
    );
  }
  if (existing.request_fingerprint !== input.requestFingerprint) {
    return NextResponse.json(
      {
        error:
          'Idempotency-Key already used with a different request payload. Generate a fresh key for the new purchase.',
      },
      { status: 409 }
    );
  }
  return null;
}
