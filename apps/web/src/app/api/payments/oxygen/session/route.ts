import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { createClient } from '@/lib/supabase/server';
import { oxygenSessionSchema } from '@/schemas/oxygen-session';

/** Normal customer sign-in for the isolated staging handoff. No worker credentials. */
export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV === 'production' || !connectOxygenRuntime())
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403 })
    );
  if (
    !(await ensureActionRateLimit('oxygen-session', {
      requests: 5,
      windowMs: 60_000,
    }))
  )
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  const body = await readBoundedJsonBody(request, 8192);
  const parsed = oxygenSessionSchema.safeParse(body.ok ? body.body : null);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid sign-in details' },
      { status: 400 }
    );
  try {
    const client = await createClient();
    const { error, data } = await client.auth.signInWithPassword(parsed.data);
    if (error || !data.user)
      return NextResponse.json({ error: 'Unable to sign in' }, { status: 401 });
    return NextResponse.json(
      { authenticated: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'Unable to sign in' }, { status: 503 });
  }
}
