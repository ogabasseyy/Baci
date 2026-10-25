import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import {
  performOxygenPaymentRecovery,
  readOxygenPaymentRecovery,
} from '@/lib/payments/oxygen/payment-recovery';
import { createOxygenPaymentRecoveryRecorder } from '@/lib/payments/oxygen/payment-recovery-evidence';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { oxygenPaymentRecoveryRequestSchema } from '@/schemas/oxygen-payment-recovery';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get('workflowId'));
  if (!id.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Recovery unavailable' },
      { status: 503, headers }
    );
  try {
    return NextResponse.json(
      await readOxygenPaymentRecovery(auth.supabase, id.data, connection.hosts),
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: 'Recovery unavailable' },
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
    !(await ensureActionRateLimit('oxygen-payment-recovery', {
      requests: 10,
      windowMs: 60000,
    }))
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) throw new Error('Invalid');
    input = JSON.parse(body) as unknown;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  }
  const parsed = oxygenPaymentRecoveryRequestSchema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Recovery unavailable' },
      { status: 503, headers }
    );
  try {
    const result = await performOxygenPaymentRecovery(
      auth.supabase,
      connection.worker,
      connection.recoveryProvider,
      connection.hosts,
      parsed.data,
      (worker, workflow, command) =>
        createOxygenPaymentRecoveryRecorder(
          worker,
          workflow,
          command,
          process.env.OXYGEN_DRAFT_ENCRYPTION_KEY ?? '',
          connection.hosts
        )
    );
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          'We could not confirm this step. Check for an update before trying again.',
      },
      { status: 409, headers }
    );
  }
}
