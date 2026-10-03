import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getBearerTokenFromRequest,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';
import {
  loadReceiptClaimPreview,
  recordReceiptClaimClickBestEffort,
} from '@/lib/import-notifications/receipt-claim-preview';
import { createClient } from '@/lib/supabase/server';
import { receiptClaimRouteParamsSchema } from '@/schemas/receipt-claim-route-params';
import { redeemReceiptClaimResultSchema } from '@/schemas/receipt-claim-rpc';

interface RouteContext {
  params: Promise<{ token: string }>;
}

async function parseToken(context: RouteContext) {
  const params = await context.params;
  const parsed = receiptClaimRouteParamsSchema.safeParse(params);

  if (!parsed.success) {
    return null;
  }

  return parsed.data.token;
}

function hasBearerAuthorization(request: NextRequest) {
  return Boolean(getBearerTokenFromRequest(request));
}

async function validateReceiptClaimCsrf(request: NextRequest) {
  if (hasBearerAuthorization(request)) {
    return { response: null, valid: true };
  }

  return await checkCsrfProtection(request);
}

function isMissingRedeemReceiptClaimV2Function(
  error: {
    code?: string | null;
    message?: string | null;
  } | null
) {
  if (!error) {
    return false;
  }

  if (error.code === 'PGRST202' || error.code === '42883') {
    return true;
  }

  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('redeem_receipt_claim_v2') &&
    (message.includes('could not find') ||
      message.includes('does not exist') ||
      message.includes('function'))
  );
}

async function redeemReceiptClaim({
  source,
  supabase,
  tokenHash,
}: {
  source: 'app' | 'web';
  supabase: Pick<SupabaseClient, 'rpc'>;
  tokenHash: string;
}) {
  const response = await supabase.rpc('redeem_receipt_claim_v2', {
    p_source: source,
    p_token_hash: tokenHash,
  });

  if (!isMissingRedeemReceiptClaimV2Function(response.error)) {
    return response;
  }

  return await supabase.rpc('redeem_receipt_claim', {
    p_token_hash: tokenHash,
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const token = await parseToken(context);
  if (!token) {
    return NextResponse.json(
      { error: 'Invalid receipt claim link' },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const preview = await loadReceiptClaimPreview({ supabase, token });

    if (!preview.ok) {
      return NextResponse.json(
        { error: preview.error },
        { status: preview.status }
      );
    }

    await recordReceiptClaimClickBestEffort({ source: 'web', supabase, token });

    return NextResponse.json({ claim: preview.claim });
  } catch (error) {
    console.error('Failed to load receipt claim', error);
    return NextResponse.json(
      { error: 'Failed to load receipt claim' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const csrf = await validateReceiptClaimCsrf(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  const token = await parseToken(context);
  if (!token) {
    return NextResponse.json(
      { error: 'Invalid receipt claim link' },
      { status: 400 }
    );
  }

  // Verified-email is enforced before either RPC: the pre-deploy v2
  // implementation validates only the JWT email, so gating on the missing
  // function alone would let unverified accounts redeem during the rollout
  // window. The hardened RPC re-checks as defense in depth.
  if (!auth.user.email_confirmed_at) {
    return NextResponse.json(
      {
        error: 'Verify your email address before claiming this receipt',
        code: 'EMAIL_UNVERIFIED',
      },
      { status: 403 }
    );
  }

  try {
    const { data, error } = await redeemReceiptClaim({
      source: hasBearerAuthorization(request) ? 'app' : 'web',
      supabase: auth.supabase,
      tokenHash: hashReceiptClaimToken(token),
    });

    if (error) {
      throw new Error(`Failed to redeem receipt claim: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Receipt claim link not found' },
        { status: 404 }
      );
    }

    const parsedResult = redeemReceiptClaimResultSchema.safeParse(data);
    if (!parsedResult.success) {
      throw new Error(
        'Failed to redeem receipt claim: invalid response structure'
      );
    }

    const result = parsedResult.data;

    if (result.status === 'email_unverified') {
      return NextResponse.json(
        {
          error: 'Verify your email address before claiming this receipt',
          code: 'EMAIL_UNVERIFIED',
        },
        { status: 403 }
      );
    }

    if (result.status === 'not_found') {
      return NextResponse.json(
        { error: 'Receipt claim link not found' },
        { status: 404 }
      );
    }

    if (result.status === 'expired') {
      return NextResponse.json(
        { error: 'Receipt claim link has expired' },
        { status: 410 }
      );
    }

    if (result.status === 'email_mismatch') {
      // Manual-order claims redeem invoices and proformas as well as
      // receipts, and the redeem result carries no document kind: keep the
      // copy kind-neutral instead of naming the wrong document.
      return NextResponse.json(
        {
          error:
            'Sign in with the email address that received this document link',
        },
        { status: 403 }
      );
    }

    if (result.status === 'already_used') {
      return NextResponse.json(
        { error: 'Receipt claim link has already been used' },
        { status: 409 }
      );
    }

    if (result.status === 'customer_link_failed') {
      return NextResponse.json(
        { error: 'This receipt link cannot be linked to your account' },
        { status: 403 }
      );
    }

    if (result.status === 'unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (result.status !== 'ok') {
      throw new Error(
        `Failed to redeem receipt claim: ${result.status || 'unknown_status'}`
      );
    }

    return NextResponse.json({
      redirectPath: result.redirectPath || '/receipts',
      success: true,
    });
  } catch (error) {
    console.error('Failed to redeem receipt claim', error);
    return NextResponse.json(
      { error: 'Failed to redeem receipt claim' },
      { status: 500 }
    );
  }
}
