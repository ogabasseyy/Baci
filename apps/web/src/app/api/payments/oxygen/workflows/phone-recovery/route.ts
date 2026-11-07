import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { oxygenPhoneRecoverySchema } from '@/schemas/oxygen-phone-recovery';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
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
  const body = await readBoundedJsonBody(request, 1024);
  const input = oxygenPhoneRecoverySchema.safeParse(body.ok ? body.body : null);
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    if (
      !(await checkOxygenProviderRateLimit(auth.user.id, 'phone-recovery', 6))
        .allowed
    )
      return NextResponse.json(
        { error: 'Please wait before trying again.' },
        { status: 429, headers }
      );
  } catch {
    return NextResponse.json(
      { error: 'Unable to continue right now.' },
      { status: 503, headers }
    );
  }
  const result = await auth.supabase.rpc(
    'oxygen_abandon_queued_phone_verification',
    {
      p_workflow_id: input.data.workflowId,
      p_version: input.data.version,
      p_key: input.data.idempotencyKey,
    }
  );
  if (result.error || result.data !== true)
    return NextResponse.json(
      { error: 'Unable to continue. Check your application status.' },
      { status: 409, headers }
    );
  return NextResponse.json({ retired: true }, { headers });
}
