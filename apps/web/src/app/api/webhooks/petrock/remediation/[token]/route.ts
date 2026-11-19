import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  capturePetrockFeedbackBody,
  hashPetrockFeedbackToken,
  petrockFeedbackHashesMatch,
} from '@/lib/imei-providers/petrock/petrock-feedback-capture';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

const OPEN_REMEDIATION_STATUSES = [
  'eligibility_pending',
  'submitted',
  'in_progress',
  'submission_unknown',
];

const accepted = () => NextResponse.json({ received: true }, { status: 200 });

export async function POST(
  request: NextRequest | Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const rateLimit = await checkRateLimit(request as NextRequest);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }
  const capture = await capturePetrockFeedbackBody(request);
  if (capture.tooLarge) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const { token } = await params;
  const tokenHash = hashPetrockFeedbackToken(token);
  if (!tokenHash) return accepted();

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('petrock_orders')
    .select('id, feedback_token_hash')
    .eq('feedback_token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    console.error('[Petrock Remediation Feedback] Order lookup failed', {
      error,
    });
    return NextResponse.json({ error: 'Capture unavailable' }, { status: 503 });
  }
  const order = data as {
    feedback_token_hash: string;
    id: string;
  } | null;
  if (
    !order ||
    !petrockFeedbackHashesMatch(tokenHash, order.feedback_token_hash)
  ) {
    return accepted();
  }

  const now = new Date().toISOString();
  const { error: nudgeError } = await supabaseAdmin
    .from('petrock_orders')
    .update({ next_poll_at: now, updated_at: now })
    .eq('id', order.id)
    .in('status', OPEN_REMEDIATION_STATUSES);
  if (nudgeError) {
    console.error('[Petrock Remediation Feedback] Cron nudge failed', {
      error: nudgeError,
      orderId: order.id,
    });
    return NextResponse.json({ error: 'Capture unavailable' }, { status: 503 });
  }

  const queryKeys = [...new Set(new URL(request.url).searchParams.keys())]
    .slice(0, 50)
    .sort();
  const { error: eventError } = await supabaseAdmin
    .from('petrock_order_events')
    .insert({
      event_type: 'feedback_callback_received',
      from_status: null,
      metadata: {
        bodyBytes: capture.bodyBytes,
        bodyKeys: capture.bodyKeys,
        bodySha256: capture.bodySha256,
        contentType: capture.contentType || null,
        queryKeys,
      },
      order_id: order.id,
      to_status: null,
    });
  if (eventError) {
    console.error('[Petrock Remediation Feedback] Audit insert failed', {
      error: eventError,
      orderId: order.id,
    });
    return NextResponse.json({ error: 'Capture unavailable' }, { status: 503 });
  }
  return accepted();
}
