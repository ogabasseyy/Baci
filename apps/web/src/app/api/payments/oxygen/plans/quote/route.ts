import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { quoteOxygenPlan } from '@/lib/payments/oxygen/quote-plan';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { oxygenPlanQuoteSchema } from '@/schemas/oxygen-plan-quote';
export const maxDuration = 120;
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403, headers })
    );
  if (
    !(await ensureActionRateLimit('oxygen-plan-quote', {
      requests: 12,
      windowMs: 60000,
    }))
  )
    return NextResponse.json(
      { error: 'Please wait before choosing another plan.' },
      { status: 429, headers }
    );
  const body = await readBoundedJsonBody(request, 2048);
  const input = oxygenPlanQuoteSchema.safeParse(body.ok ? body.body : null);
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid plan' },
      { status: 400, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Plan service unavailable' },
      { status: 503, headers }
    );
  try {
    return NextResponse.json(
      await quoteOxygenPlan(auth.supabase, connection, input.data),
      { headers }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'We could not confirm this plan. Your application is saved. Check again to retrieve a confirmed breakdown; an uncertain booking will not be repeated.',
      },
      { status: 409, headers }
    );
  }
}
