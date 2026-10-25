import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import {
  readOxygenActivationTrial,
  runOxygenActivationTrial,
} from '@/lib/payments/oxygen/activation-trial';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { oxygenActivationTrialBodySchema } from '@/schemas/oxygen-activation-trial';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  if (!connectOxygenRuntime())
    return NextResponse.json(
      { error: 'Trial unavailable' },
      { status: 404, headers }
    );
  try {
    return NextResponse.json(await readOxygenActivationTrial(auth.supabase), {
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: 'Trial unavailable' },
      { status: 404, headers }
    );
  }
}
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403, headers })
    );
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  if (
    !(await ensureActionRateLimit('oxygen-activation-trial', {
      requests: 3,
      windowMs: 60000,
    }))
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  try {
    const body = await request.text();
    if (body.length > 1024) throw new Error('Invalid');
    oxygenActivationTrialBodySchema.parse(JSON.parse(body));
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  }
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Trial unavailable' },
      { status: 404, headers }
    );
  try {
    // Establish ownership before worker login; RPC repeats ownership and exact-booking checks.
    await readOxygenActivationTrial(auth.supabase);
    const worker = await connection.worker();
    await runOxygenActivationTrial(
      auth.supabase,
      worker,
      connection.activationTrialRequest,
      process.env.OXYGEN_DRAFT_ENCRYPTION_KEY ?? ''
    );
    return NextResponse.json(await readOxygenActivationTrial(auth.supabase), {
      headers,
    });
  } catch {
    return NextResponse.json(
      {
        error: 'Activation could not be confirmed. Do not repeat the request.',
      },
      { status: 409, headers }
    );
  }
}
