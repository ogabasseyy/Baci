import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  oxygenPlanAcceptanceInputSchema,
  oxygenPlanAcceptanceResultSchema,
} from '@/schemas/oxygen-plan-acceptance';

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
  const body = await readBoundedJsonBody(request, 1024);
  if (!body.ok)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: body.reason === 'too_large' ? 413 : 400, headers }
    );
  const input = oxygenPlanAcceptanceInputSchema.safeParse(body.body);
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    const { data, error } = await auth.supabase.rpc(
      'oxygen_accept_saved_plan',
      {
        p_workflow_id: input.data.workflowId,
        p_booking_reference: input.data.bookingReference,
        p_version: input.data.version,
      }
    );
    if (error)
      return NextResponse.json(
        { error: 'Plan unavailable' },
        { status: error.code === '42501' ? 404 : 409, headers }
      );
    const result = oxygenPlanAcceptanceResultSchema.safeParse(data);
    if (
      !result.success ||
      result.data.bookingReference !== input.data.bookingReference
    )
      return NextResponse.json(
        { error: 'Plan unavailable' },
        { status: 503, headers }
      );
    return NextResponse.json(result.data, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Plan unavailable' },
      { status: 503, headers }
    );
  }
}
