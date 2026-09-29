import { type NextRequest, NextResponse } from 'next/server';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID,
} from '@/lib/checkout/redvault-live-pilot';
import { getRedvaultPaymentAvailability } from '@/lib/checkout/redvault-payment-availability';
import { redvaultAvailabilityQuerySchema } from '@/schemas/redvault-availability-query';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const parsed = redvaultAvailabilityQuerySchema.safeParse({
    merchant_id: request.nextUrl.searchParams.get('merchant_id'),
    product_id: request.nextUrl.searchParams.get('product_id') ?? undefined,
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

  const availability = getRedvaultPaymentAvailability();
  if (availability.reason === 'private_live_pilot') {
    const policy = getRedvaultLivePilotPolicy();
    if (!policy || parsed.data.product_id !== policy.productId) {
      return NextResponse.json(
        { available: false, reason: 'unavailable' },
        { headers: NO_STORE_HEADERS }
      );
    }
    const auth = await authenticateApiRequest(request);
    if (auth?.user?.id !== REDVAULT_PILOT_USER_ID) {
      return NextResponse.json(
        { available: false, reason: 'unavailable' },
        { headers: NO_STORE_HEADERS }
      );
    }
  }
  return NextResponse.json(availability, {
    headers: NO_STORE_HEADERS,
  });
}
