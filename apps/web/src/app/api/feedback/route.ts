import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { sendFeedbackReportEmail } from '@/lib/feedback/send-feedback-report-email';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { checkRateLimit } from '@/lib/rate-limiter';
import { feedbackReportSchema } from '@/schemas/feedback-report';

const FEEDBACK_RATE_LIMIT = { maxRequests: 5, windowMinutes: 10 };

/**
 * In-app "Send feedback" for merchant owners and staff. Saves the report
 * under the caller's own RLS session, then emails it to the Baci support
 * inbox. A failed email never loses the report: it is already stored.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!(auth.user && auth.supabase)) {
    return NextResponse.json(
      { error: auth.error ?? 'Unauthorized' },
      { status: 401 }
    );
  }
  const { user, supabase } = auth;

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = feedbackReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid feedback', code: 'invalid_feedback' },
      { status: 400 }
    );
  }

  const merchant = await getMerchantForApiRequest(supabase, user.id);
  if (!merchant) {
    return NextResponse.json({ error: 'No merchant found' }, { status: 403 });
  }

  // The privileged email sender may only run behind a working per-user limit.
  let allowed: boolean;
  try {
    allowed = await checkRateLimit(
      supabase,
      user.id,
      'feedback-report',
      FEEDBACK_RATE_LIMIT.maxRequests,
      FEEDBACK_RATE_LIMIT.windowMinutes,
      { failClosed: true }
    );
  } catch {
    return NextResponse.json(
      {
        error: 'Feedback is temporarily unavailable. Try again shortly.',
        code: 'rate_limit_unavailable',
      },
      { status: 503 }
    );
  }
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'You have sent a lot of feedback recently. Try again later.',
        code: 'rate_limited',
      },
      { status: 429 }
    );
  }

  const report = parsed.data;
  const { data: saved, error: insertError } = await supabase
    .from('feedback')
    .insert({
      merchant_id: merchant.merchantId,
      user_id: user.id,
      message: report.message,
      screen: report.screen ?? null,
      platform: report.platform ?? null,
      app_version: report.appVersion ?? null,
      device: report.device ?? null,
    })
    .select('id')
    .single();
  if (insertError || !saved) {
    console.error('Feedback insert failed:', insertError?.code);
    return NextResponse.json(
      { error: 'Could not save feedback', code: 'feedback_save_failed' },
      { status: 500 }
    );
  }

  const emailed = await sendFeedbackReportEmail({
    report,
    feedbackId: saved.id,
    businessName: merchant.businessName ?? null,
    merchantSlug: merchant.merchantSlug ?? null,
    senderEmail: user.email ?? null,
    submittedAt: new Date(),
  });

  return NextResponse.json({ id: saved.id, emailed }, { status: 201 });
}
