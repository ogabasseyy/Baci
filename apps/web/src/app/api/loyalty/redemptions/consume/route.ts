import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getBearerTokenFromRequest,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { loyaltyRedemptionConsumeSchema } from '@/schemas/loyalty-redemption-consume';

type ConsumeRpcResult = {
  success?: boolean;
  error?: string;
  redemption_id?: string;
  discount_code?: string;
  reward_type?: string;
  reward_id?: string | null;
  reward_name?: string | null;
  reward_product_id?: string | null;
  customer_id?: string;
  used_at?: string;
};

/**
 * POST - Mark a manual-fulfillment redemption as consumed. The
 * consume_loyalty_redemption RPC performs the atomic single-use update
 * under the caller's merchant access (owner or staff), which the
 * owner-only RLS policy on reward_redemptions cannot express.
 *
 * Intended caller: the merchant staff fulfillment client (dashboard /
 * mobile admin) that presents a customer's manual reward code at
 * fulfillment; it supplies a per-attempt idempotency_key so a
 * lost-response retry replays the receipt. No storefront caller
 * exists by design — this is staff-only (authenticated, CSRF-checked,
 * marketing:edit-gated), and the contract is pinned by route.test.ts.
 *
 * NOT YET WIRED: no dashboard or mobile-admin client calls this
 * endpoint yet, so manual-fulfillment rewards (free product / free
 * shipping / exclusive access) cannot be consumed in-product until
 * that staff client lands. The endpoint ships ahead of the client so
 * the contract (auth, permission, idempotent replay) is pinned and
 * reviewable; it is not a fulfillment path staff can use today.
 */
export async function POST(request: NextRequest) {
  try {
    // Bearer [REDACTED] (mobile admin fulfillment) or cookies (dashboard):
    // authenticateApiRequest verifies either and returns the
    // token-scoped client the RPC must run under.
    const auth = await authenticateApiRequest(request);
    if (!auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const supabase = auth.supabase;
    const user = auth.user;

    // Bearer [REDACTED] are not cookie-ambient, so CSRF only applies to
    // the cookie-authenticated dashboard path. Gate on an extracted
    // token, not the scheme word: a bare `Authorization: Bearer`
    // header carries no token, authentication falls back to cookies,
    // and such a request must not skip CSRF. (A present token was
    // already verified above — an invalid one returned 401.)
    if (getBearerTokenFromRequest(request) === null) {
      const { valid, response } = await checkCsrfProtection(request);
      if (!valid) {
        return (
          response ??
          NextResponse.json(
            { error: 'CSRF validation failed' },
            { status: 403 }
          )
        );
      }
    }

    // Validate the payload before any merchant/staff database lookup:
    // malformed input is rejected without touching the database.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    const parsed = loyaltyRedemptionConsumeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A redemption code is required' },
        { status: 400 }
      );
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'marketing', 'edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await supabase.rpc('consume_loyalty_redemption', {
      p_merchant_id: merchantContext.merchantId,
      p_code: parsed.data.code,
      p_idempotency_key: parsed.data.idempotency_key,
    });

    if (error) {
      console.error('Error consuming loyalty redemption:', error);
      return NextResponse.json(
        { error: 'Failed to consume redemption' },
        { status: 500 }
      );
    }

    const result = (data ?? {}) as ConsumeRpcResult;
    if (!result.success) {
      if (result.error === 'forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (result.error === 'already_consumed') {
        // Explicit reuse signal with the original receipt: staff see
        // when (and what) was fulfilled instead of a fresh success.
        return NextResponse.json(
          {
            error: 'Redemption already consumed',
            data: {
              id: result.redemption_id,
              discount_code: result.discount_code,
              reward_type: result.reward_type,
              reward_id: result.reward_id ?? null,
              reward_name: result.reward_name ?? null,
              reward_product_id: result.reward_product_id ?? null,
              customer_id: result.customer_id,
              used_at: result.used_at,
            },
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'Redemption not found or already consumed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: result.redemption_id,
        discount_code: result.discount_code,
        reward_type: result.reward_type,
        reward_id: result.reward_id ?? null,
        reward_name: result.reward_name ?? null,
        reward_product_id: result.reward_product_id ?? null,
        customer_id: result.customer_id,
        used_at: result.used_at,
      },
    });
  } catch (error) {
    console.error('Loyalty redemption consume POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
