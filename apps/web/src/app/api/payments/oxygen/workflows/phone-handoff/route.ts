import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { issueOxygenPhoneHandoff } from '@/lib/payments/oxygen/phone-handoff';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { oxygenSelfieStatusRequestSchema } from '@/schemas/oxygen-selfie-status';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
export async function POST(request: NextRequest) {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT !== 'true'
  )
    return NextResponse.json(
      { error: 'Phone handoff unavailable' },
      { status: 404, headers }
    );
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
  const input = oxygenSelfieStatusRequestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  if (
    !(await ensureActionRateLimit(`oxygen-phone-handoff:${auth.user.id}`, {
      requests: 3,
      windowMs: 60_000,
    }))
  )
    return NextResponse.json(
      { error: 'Please wait before trying again' },
      { status: 429, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Phone handoff unavailable' },
      { status: 503, headers }
    );
  try {
    return NextResponse.json(
      await issueOxygenPhoneHandoff(
        auth.supabase,
        connection.worker,
        connection.provider,
        connection.partnerReference,
        input.data.workflowId
      ),
      { headers }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'Unable to prepare phone verification. Your application is saved.',
      },
      { status: 503, headers }
    );
  }
}
