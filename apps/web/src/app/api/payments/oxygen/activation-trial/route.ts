import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { reconcileOxygenActivation } from '@/lib/payments/oxygen/activation-reconciliation';
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
    const { reference } = oxygenActivationTrialBodySchema.parse({
      reference:
        request.nextUrl.searchParams.get('reference') ??
        'b75cd437-28af-4008-a1af-7e6810282833',
    });
    return NextResponse.json(
      await readOxygenActivationTrial(auth.supabase, reference),
      {
        headers,
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Trial unavailable' },
      { status: 404, headers }
    );
  }
}
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
    !(await ensureActionRateLimit('oxygen-activation-trial', {
      requests: 3,
      windowMs: 60000,
    }))
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  let reference: string;
  try {
    const body = await request.text();
    if (body.length > 1024) throw new Error('Invalid');
    reference = oxygenActivationTrialBodySchema.parse(
      JSON.parse(body)
    ).reference;
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
    const before = await readOxygenActivationTrial(auth.supabase, reference);
    const worker = await connection.worker();
    if (before.status !== 'activated')
      await runOxygenActivationTrial(
        auth.supabase,
        worker,
        connection.activationTrialRequest,
        process.env.OXYGEN_DRAFT_ENCRYPTION_KEY ?? '',
        reference
      );
    const after = await readOxygenActivationTrial(auth.supabase, reference);
    if (after.status === 'activated' && !after.orderConfirmed)
      await reconcileOxygenActivation(worker, reference);
    return NextResponse.json(
      await readOxygenActivationTrial(auth.supabase, reference),
      {
        headers,
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: 'Activation could not be confirmed. Do not repeat the request.',
      },
      { status: 409, headers }
    );
  }
}
