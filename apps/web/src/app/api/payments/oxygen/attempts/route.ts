import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { decideOxygenNewInitiation } from '@/lib/payments/oxygen/availability';
import { resolveOxygenOrderContext } from '@/lib/payments/oxygen/context';
import { mapInitiationDecision } from '@/lib/payments/oxygen/initiation';
import { oxygenAttemptRequestSchema } from '@/schemas/oxygen-requests';

// POST /api/payments/oxygen/attempts — Phase A initiation probe. Pinned
// pipeline: rate limit, CSRF, body validation, auth, order proof, then the
// shared S-03 verdict. Creates nothing and calls no provider: deny paths map
// to 403, and even a policy allow maps to 503 until Phase B exists.
export async function POST(request: NextRequest) {
  const allowed = await ensureActionRateLimit('oxygen-initiation', {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = oxygenAttemptRequestSchema.safeParse(body);
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

  const mapped = mapInitiationDecision(
    decideOxygenNewInitiation(context.s03input)
  );
  return NextResponse.json(mapped.body, { status: mapped.status });
}
