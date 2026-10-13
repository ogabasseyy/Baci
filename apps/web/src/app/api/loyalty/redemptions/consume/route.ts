import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { loyaltyRedemptionConsumeSchema } from '@/schemas/loyalty-redemption-consume';

type ConsumeRpcResult = {
  success?: boolean;
  error?: string;
  redemption_id?: string;
  discount_code?: string;
  reward_type?: string;
  customer_id?: string;
  used_at?: string;
};

/**
 * POST - Mark a manual-fulfillment redemption as consumed. The
 * consume_loyalty_redemption RPC performs the atomic single-use update
 * under the caller's merchant access (owner or staff), which the
 * owner-only RLS policy on reward_redemptions cannot express.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
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

    const { data, error } = await supabase.rpc('consume_loyalty_redemption', {
      p_merchant_id: merchantContext.merchantId,
      p_code: parsed.data.code,
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
