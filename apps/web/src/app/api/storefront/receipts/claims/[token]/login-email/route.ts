import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  loadReceiptClaimLoginEmailHint,
  parseReceiptClaimToken,
  recordReceiptClaimLoginStarted,
  recordReceiptClaimLoginStartedBestEffort,
} from '@/lib/import-notifications/receipt-claim-preview';
import { createClient } from '@/lib/supabase/server';
import { receiptClaimLoginEmailQuerySchema } from '@/schemas/receipt-claim-login-email-query';

interface RouteContext {
  params: Promise<{ token: string }>;
}

async function parseToken(context: RouteContext) {
  const params = await context.params;
  return parseReceiptClaimToken(params.token);
}

function parseLoginEmailQuery(request: NextRequest) {
  return receiptClaimLoginEmailQuerySchema.safeParse({
    source: request.nextUrl.searchParams.get('source') ?? undefined,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const token = await parseToken(context);
  if (!token) {
    return NextResponse.json(
      { error: 'Invalid receipt claim link' },
      { status: 400 }
    );
  }

  const query = parseLoginEmailQuery(request);
  if (!query.success) {
    return NextResponse.json(
      { error: 'Invalid receipt claim login email query' },
      { status: 400 }
    );
  }

  // The hint is unauthenticated bearer-token surface (documented accepted
  // risk). Per-IP polling is bounded by the proxy security stage, which
  // counts this pathname once against the /api/storefront bucket
  // (100/min): no in-route check here, or one request would burn two
  // tokens. The GET+source=app activity write stays because the native
  // claim screen cannot do cookie-CSRF POST.
  try {
    const supabase = await createClient();
    // The branded service client is constructed inside the loader only
    // after the anon preview has validated the token.
    const hint = await loadReceiptClaimLoginEmailHint({ supabase, token });

    if (!hint.ok) {
      return NextResponse.json({ error: hint.error }, { status: hint.status });
    }

    if (query.data.source && query.data.source !== 'web') {
      await recordReceiptClaimLoginStartedBestEffort({
        source: query.data.source,
        supabase,
        token,
      });
    }

    return NextResponse.json({ emailHint: hint.emailHint });
  } catch (error) {
    console.error('Failed to load receipt claim login email', error);
    return NextResponse.json(
      { error: 'Failed to load receipt claim login email' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const token = await parseToken(context);
  if (!token) {
    return NextResponse.json(
      { error: 'Invalid receipt claim link' },
      { status: 400 }
    );
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  try {
    const supabase = await createClient();
    await recordReceiptClaimLoginStarted({ source: 'web', supabase, token });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to record receipt claim login start', error);
    return NextResponse.json(
      {
        error: 'Failed to record receipt claim login start',
        code: 'login_start_tracking_failed',
      },
      { status: 500 }
    );
  }
}
