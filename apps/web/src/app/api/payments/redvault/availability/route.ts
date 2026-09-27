import { type NextRequest, NextResponse } from 'next/server';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { getRedvaultPaymentAvailability } from '@/lib/checkout/redvault-payment-availability';
import { redvaultAvailabilityQuerySchema } from '@/schemas/redvault-availability-query';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export function GET(request: NextRequest) {
  const parsed = redvaultAvailabilityQuerySchema.safeParse({
    merchant_id: request.nextUrl.searchParams.get('merchant_id'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { available: false, reason: 'invalid_merchant_id' },
      { headers: NO_STORE_HEADERS, status: 400 }
    );
  }

  if (parsed.data.merchant_id !== OGABASSEY_MERCHANT_ID) {
    return NextResponse.json(
      { available: false, reason: 'merchant_unavailable' },
      { headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(getRedvaultPaymentAvailability(), {
    headers: NO_STORE_HEADERS,
  });
}
