import { isRedvaultEligibleProduct } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID,
} from '@/lib/checkout/redvault-live-pilot';
import { verifyRedvaultLivePilotDatabasePolicy } from '@/lib/checkout/redvault-live-pilot-database-policy';
import {
  getRedvaultPaymentAvailability,
  isRedvaultLivePilotReason,
} from '@/lib/checkout/redvault-payment-availability';
import { createClient } from '@/lib/supabase/server';
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
  if (isRedvaultLivePilotReason(availability.reason)) {
    const publicProductTest = availability.reason === 'public_product_test';
    const policy = getRedvaultLivePilotPolicy();
    if (
      !policy ||
      parsed.data.product_id !== policy.productId ||
      (publicProductTest && policy.audience !== 'public_product_test')
    ) {
      return NextResponse.json(
        { available: false, reason: 'unavailable' },
        { headers: NO_STORE_HEADERS }
      );
    }
    const auth = publicProductTest
      ? null
      : await authenticateApiRequest(request);
    if (!publicProductTest && auth?.user?.id !== REDVAULT_PILOT_USER_ID) {
      return NextResponse.json(
        { available: false, reason: 'unavailable' },
        { headers: NO_STORE_HEADERS }
      );
    }
    let supabase = auth?.supabase;
    if (publicProductTest) {
      try {
        supabase = await createClient();
        if (
          !(await verifyRedvaultLivePilotDatabasePolicy({
            client: supabase,
            policy,
          }))
        ) {
          return NextResponse.json(
            { available: false, reason: 'unavailable' },
            { headers: NO_STORE_HEADERS }
          );
        }
      } catch {
        return NextResponse.json(
          { available: false, reason: 'unavailable' },
          { headers: NO_STORE_HEADERS }
        );
      }
    }
    // Activation validates the dedicated-product shape (NGN 100, no
    // variants, inventory tracking off, active status, REDVAULT-eligible
    // brand) only once; recheck the live catalog row here so a repriced,
    // variant-enabled, newly tracked, deactivated, or
    // renamed-to-ineligible product stops being offered. Any lookup
    // failure fails closed.
    const shapeLookup = supabase
      ? await supabase
          .from('products')
          .select(
            'price, has_variants, inventory_tracking_policy, brand, name, status'
          )
          .eq('id', policy.productId)
          .maybeSingle()
      : { data: null, error: { message: 'unavailable' } };
    const shape = shapeLookup.data as {
      price: number | string | null;
      has_variants: boolean | null;
      inventory_tracking_policy: string | null;
      brand: string | null;
      name: string | null;
      status: string | null;
    } | null;
    if (
      shapeLookup.error ||
      !shape ||
      Number(shape.price) !== 100 ||
      shape.has_variants !== false ||
      shape.inventory_tracking_policy !== 'off' ||
      shape.status !== 'active' ||
      !isRedvaultEligibleProduct({ brand: shape.brand, name: shape.name })
    ) {
      return NextResponse.json(
        { available: false, reason: 'unavailable' },
        { headers: NO_STORE_HEADERS }
      );
    }
    // Expose the pilot expiry so checkout clients can stop retaining a
    // positive result (and revalidate) once the short pilot window ends.
    return NextResponse.json(
      {
        ...availability,
        ...(policy.expiresAt === null ? {} : { expiresAt: policy.expiresAt }),
      },
      { headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json(availability, {
    headers: NO_STORE_HEADERS,
  });
}
