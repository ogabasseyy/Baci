import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { resolveOxygenEnvironment } from '@/lib/payments/oxygen/environment';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { getTrustedClientIdentifier } from '@/lib/rate-limit-client';
import { createClient } from '@/lib/supabase/server';
import { oxygenStorefrontAvailabilityQuery } from '@/schemas/oxygen-storefront-availability';

/** Display hint only. Workflow creation independently enforces the policy. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  const authenticated = !auth.error && Boolean(auth.user && auth.supabase);
  const rateLimitSubject =
    authenticated && auth.user
      ? auth.user.id
      : `guest:${getTrustedClientIdentifier(request)}`;
  const rateLimitMax = rateLimitSubject === 'guest:unknown' ? 120 : 30;
  try {
    if (
      !(
        await checkOxygenProviderRateLimit(
          rateLimitSubject,
          'storefront-availability',
          rateLimitMax
        )
      ).allowed
    )
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  } catch {
    return NextResponse.json(
      { error: 'Availability unavailable' },
      { status: 503 }
    );
  }
  const parsed = oxygenStorefrontAvailabilityQuery.safeParse({
    merchantId: request.nextUrl.searchParams.get('merchantId'),
  });
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  if (
    resolveOxygenEnvironment() !== 'production' ||
    process.env.OXYGEN_PRODUCTION_RUNTIME_ENABLED !== 'true'
  )
    return NextResponse.json(
      { available: false },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  try {
    const supabase =
      authenticated && auth.supabase
        ? auth.supabase
        : createClient(await cookies());
    const { data, error } = await supabase.rpc(
      'oxygen_storefront_pilot_available',
      { p_merchant_id: parsed.data.merchantId }
    );
    if (error || typeof data !== 'boolean')
      throw new Error('Availability unavailable');
    return NextResponse.json(
      { available: data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Availability unavailable' },
      { status: 503 }
    );
  }
}
