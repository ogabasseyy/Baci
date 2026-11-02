import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getBearerTokenFromRequest,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { projectOxygenChat } from '@/lib/payments/oxygen/chat-pipeline';
import { oxygenChatRequestSchema } from '@/schemas/oxygen-chat';
import { oxygenWorkflowSnapshotSchema } from '@/schemas/oxygen-workflow';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/** Authenticated conversation continuation, not an inbound WhatsApp webhook. */
export async function POST(request: NextRequest) {
  if (
    !(await ensureActionRateLimit('oxygen-chat', {
      requests: 20,
      windowMs: 60_000,
    }))
  )
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers }
    );
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  // Bearer verification above establishes customer identity. Cookie callers also
  // need browser CSRF protection; a channel string cannot bypass either guard.
  if (!getBearerTokenFromRequest(request)) {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid)
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 403, headers }
      );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers }
    );
  }
  const parsed = oxygenChatRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  try {
    // This RPC rechecks order/customer/merchant ownership transactionally and has
    // a unique order constraint. Repeated message delivery resumes the same row.
    // Neither status nor resume enqueues any provider command or financial work.
    const { data, error } = await auth.supabase.rpc('oxygen_start_workflow', {
      p_order_id: parsed.data.orderId,
      p_channel: 'chat',
    });
    if (error?.code === '42501')
      return NextResponse.json(
        { error: 'Application not found' },
        { status: 404, headers }
      );
    if (error?.code === '22023')
      return NextResponse.json(
        { error: 'Application unavailable' },
        { status: 409, headers }
      );
    const snapshot = oxygenWorkflowSnapshotSchema.safeParse(data);
    if (
      error ||
      !snapshot.success ||
      snapshot.data.environment !== 'staging' ||
      snapshot.data.order_id !== parsed.data.orderId
    )
      return NextResponse.json(
        { error: 'Application unavailable' },
        { status: 503, headers }
      );
    return NextResponse.json(projectOxygenChat(parsed.data, snapshot.data), {
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: 'Application unavailable' },
      { status: 503, headers }
    );
  }
}
