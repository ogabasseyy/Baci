import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  oxygenApprovalCodeQuerySchema,
  oxygenApprovalCodeResponseSchema,
} from '@/schemas/oxygen-approval-code';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
/** Reads timing metadata only; requesting/resending still uses the durable action ledger. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const query = oxygenApprovalCodeQuerySchema.safeParse({
    workflowId: request.nextUrl.searchParams.get('workflowId'),
  });
  if (!query.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    const { data, error } = await auth.supabase.rpc(
      'oxygen_approval_code_window',
      { p_workflow_id: query.data.workflowId }
    );
    const result = oxygenApprovalCodeResponseSchema.safeParse({ window: data });
    if (error || !result.success)
      return NextResponse.json(
        { error: 'Code status unavailable' },
        { status: error?.code === '42501' ? 404 : 503, headers }
      );
    return NextResponse.json(result.data, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Code status unavailable' },
      { status: 503, headers }
    );
  }
}
