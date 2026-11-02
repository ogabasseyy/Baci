import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { projectWorkflow } from '@/lib/payments/oxygen/workflow';
import {
  oxygenWorkflowRequestSchema,
  oxygenWorkflowSnapshotSchema,
} from '@/schemas/oxygen-workflow';

// Creates/resumes a durable staging draft only. No provider call or financial action.
export async function POST(request: NextRequest) {
  if (
    !(await ensureActionRateLimit('oxygen-workflow', {
      requests: 10,
      windowMs: 60_000,
    }))
  ) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403 })
    );
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = oxygenWorkflowRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  try {
    // Ownership is rechecked transactionally inside the narrow RPC. The caller
    // cannot select merchant, customer, environment or trusted provider facts.
    const { data, error } = await auth.supabase.rpc('oxygen_start_workflow', {
      p_order_id: parsed.data.orderId,
      p_channel: parsed.data.channel,
    });
    if (error) {
      if (error.code === '42501')
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      if (error.code === '22023')
        return NextResponse.json(
          { error: 'Order unavailable' },
          { status: 409 }
        );
      return NextResponse.json(
        { error: 'Workflow storage unavailable' },
        { status: 503 }
      );
    }
    const snapshot = oxygenWorkflowSnapshotSchema.safeParse(data);
    if (!snapshot.success)
      return NextResponse.json(
        { error: 'Workflow storage unavailable' },
        { status: 503 }
      );
    return NextResponse.json(
      {
        workflow: snapshot.data,
        ...projectWorkflow(snapshot.data.stage),
        executionEnabled: false,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Workflow storage unavailable' },
      { status: 503 }
    );
  }
}
