import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOxygenSnapshot } from '@/lib/payments/oxygen/runtime-service';
import { readOxygenSelfieStatus } from '@/lib/payments/oxygen/selfie-status';
import { oxygenSelfieStatusRequestSchema } from '@/schemas/oxygen-selfie-status';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const input = oxygenSelfieStatusRequestSchema.safeParse({
    workflowId: request.nextUrl.searchParams.get('workflowId'),
  });
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    await readOxygenSnapshot(auth.supabase, input.data.workflowId);
  } catch {
    return NextResponse.json(
      { error: 'Workflow unavailable' },
      { status: 404, headers }
    );
  }
  if (
    !(await ensureActionRateLimit(
      `oxygen-selfie-status:${auth.user.id}:${input.data.workflowId}`,
      { requests: 6, windowMs: 60_000 }
    ))
  )
    return NextResponse.json(
      { error: 'Please wait before checking again' },
      { status: 429, headers }
    );
  const connection = connectOxygenRuntime();
  if (!connection)
    return NextResponse.json(
      { error: 'Provider unavailable' },
      { status: 503, headers }
    );
  try {
    return NextResponse.json(
      await readOxygenSelfieStatus(
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
      { error: 'Unable to confirm selfie status right now' },
      { status: 503, headers }
    );
  }
}
