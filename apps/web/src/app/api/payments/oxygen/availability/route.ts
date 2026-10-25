import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { decideOxygenNewInitiation } from '@/lib/payments/oxygen/availability';
import { resolveOxygenOrderContext } from '@/lib/payments/oxygen/context';
import { mapAvailabilityDecision } from '@/lib/payments/oxygen/initiation';
import { oxygenAvailabilityQuerySchema } from '@/schemas/oxygen-requests';

// GET /api/payments/oxygen/availability — authoritative display decision for
// one proven order. Same pinned pipeline as the attempts route with its own
// rate-limit bucket: limit, CSRF (auto-pass on safe methods, called for
// uniformity), query validation, auth, order proof, then the shared S-03
// verdict as a 200. Echoes no order details.
export async function GET(request: NextRequest) {
  const allowed = await ensureActionRateLimit('oxygen-availability', {
    requests: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many Oxygen requests. Please try again shortly.' },
      { status: 429 }
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const parsed = oxygenAvailabilityQuerySchema.safeParse({
    orderId: request.nextUrl.searchParams.get('orderId'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let context: Awaited<ReturnType<typeof resolveOxygenOrderContext>>;
  try {
    context = await resolveOxygenOrderContext(
      auth.supabase,
      parsed.data.orderId,
      auth.user.id
    );
  } catch {
    return NextResponse.json(
      { error: 'Unable to load order' },
      { status: 500 }
    );
  }
  if ('denied' in context) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  const mapped = mapAvailabilityDecision(
    decideOxygenNewInitiation(context.s03input)
  );
  return NextResponse.json(mapped.body, { status: mapped.status });
}
