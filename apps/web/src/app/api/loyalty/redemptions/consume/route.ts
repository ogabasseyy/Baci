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

// Manual-fulfillment reward types: minted by redeem_loyalty_reward as
// present-the-code redemptions that checkout never honors. Consuming
// one here is the single-use enforcement for those codes.
const MANUAL_REWARD_TYPES = [
  'free_shipping',
  'free_product',
  'exclusive_access',
] as const;

/**
 * POST - Mark a manual-fulfillment redemption as consumed. The update's
 * used=false predicate makes consumption atomic and single-use under
 * the merchant RLS policy on reward_redemptions.
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

    // Escape LIKE wildcards so a presented code matches literally.
    const presentedCode = parsed.data.code.replace(/[%_\\]/g, '\\$&');
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('reward_redemptions')
      .update({ used: true, used_at: now })
      .eq('merchant_id', merchantContext.merchantId)
      .eq('used', false)
      .in('reward_type', [...MANUAL_REWARD_TYPES])
      .ilike('discount_code', presentedCode)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .select('id, discount_code, reward_type, customer_id, used_at');

    if (error) {
      console.error('Error consuming loyalty redemption:', error);
      return NextResponse.json(
        { error: 'Failed to consume redemption' },
        { status: 500 }
      );
    }

    const consumed = data?.[0];
    if (!consumed) {
      return NextResponse.json(
        { error: 'Redemption not found or already consumed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: consumed });
  } catch (error) {
    console.error('Loyalty redemption consume POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
