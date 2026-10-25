import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  oxygenSavedPlanQuerySchema,
  oxygenSavedPlanSelectionSchema,
  oxygenSavedPlansSchema,
} from '@/schemas/oxygen-saved-plans';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
async function handle(request: NextRequest, select: boolean) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  if (select) {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid)
      return (
        csrf.response ??
        NextResponse.json(
          { error: 'Invalid request' },
          { status: 403, headers }
        )
      );
  }
  let raw: unknown = {
    workflowId: request.nextUrl.searchParams.get('workflowId'),
  };
  if (select) {
    const body = await readBoundedJsonBody(request, 1024);
    if (!body.ok)
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: body.reason === 'too_large' ? 413 : 400, headers }
      );
    raw = body.body;
  }
  const input = select
    ? oxygenSavedPlanSelectionSchema.safeParse(raw)
    : oxygenSavedPlanQuerySchema.safeParse(raw);
  if (!input.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    const { data, error } = await auth.supabase.rpc('oxygen_saved_plans', {
      p_workflow_id: input.data.workflowId,
      p_booking_reference:
        'bookingReference' in input.data ? input.data.bookingReference : null,
    });
    if (error)
      return NextResponse.json(
        { error: 'Saved plans unavailable' },
        { status: error.code === '42501' ? 404 : 503, headers }
      );
    const result = oxygenSavedPlansSchema.safeParse(data);
    if (!result.success)
      return NextResponse.json(
        { error: 'Saved plans unavailable' },
        { status: 503, headers }
      );
    return NextResponse.json(result.data, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Saved plans unavailable' },
      { status: 503, headers }
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
