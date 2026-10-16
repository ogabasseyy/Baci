import { NextResponse } from 'next/server';

/** Shared 400 for a stale or unavailable per-line condition offer. */
export function conditionOfferUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Condition offer unavailable; refresh your cart',
      details: 'invalid_condition_offer',
    },
    { status: 400 }
  );
}
