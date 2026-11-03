import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  capturePetrockFeedbackBody,
  hashPetrockFeedbackToken,
  petrockFeedbackHashesMatch,
} from '@/lib/imei-providers/petrock/petrock-feedback-capture';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

interface FeedbackLookupRow {
  feedback_token_hash: string;
  id: string;
}

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
    .from('imei_lookups')
    .select('id, feedback_token_hash')
    .eq('feedback_token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    console.error('[Petrock Feedback] Lookup failed', { error });
    return NextResponse.json({ error: 'Capture unavailable' }, { status: 503 });
  }

  const lookup = data as FeedbackLookupRow | null;
  if (
    !lookup ||
    !petrockFeedbackHashesMatch(tokenHash, lookup.feedback_token_hash)
  ) {
    return accepted();
  }

  const queryKeys = [...new Set(new URL(request.url).searchParams.keys())]
    .slice(0, 50)
    .sort();
  const { error: insertError } = await supabaseAdmin
    .from('petrock_feedback_events')
    .insert({
      body_bytes: capture.bodyBytes,
      body_keys: capture.bodyKeys,
      body_sha256: capture.bodySha256,
      content_type: capture.contentType || null,
      lookup_id: lookup.id,
      query_keys: queryKeys,
    });
  if (insertError) {
    console.error('[Petrock Feedback] Capture insert failed', {
      error: insertError,
      lookupId: lookup.id,
    });
    return NextResponse.json({ error: 'Capture unavailable' }, { status: 503 });
  }

  console.info('[Petrock Feedback] Callback captured', {
    bodyBytes: capture.bodyBytes,
    bodyKeys: capture.bodyKeys,
    lookupId: lookup.id,
    queryKeys,
  });
  return accepted();
}
