import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import { fetchDashboardMerchantContext } from '@/hooks/merchant/fetch-dashboard-merchant-context';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

// This route returns per-user SECRET merchant data (bank/nin/bvn/tokens). It
// must never be stored by any shared cache/CDN. Reading cookies() already opts
// the handler into dynamic rendering; this header is explicit defense in depth,
// matching the repo convention (see api/merchant/features/route.ts).
const PRIVATE_NO_STORE = {
  'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate',
} as const;

/**
 * Current merchant dashboard context (owner or active staff) for the signed-in
 * user.
 *
 * Why this route exists (S1): the merchant dashboard reads highly sensitive
 * own-merchant columns (nin, bvn, bank_*, stripe_*, CAPI/access tokens,
 * paystack_subaccount_code). Those reads previously ran through the browser's
 * `authenticated` Supabase client straight against `public.merchants`, which
 * forced the table's column grant to expose every secret column to the
 * `authenticated` role — and, combined with the `USING (true)` SELECT policy,
 * let ANY signed-in user read ANY merchant's secrets. This route moves the
 * own-row read behind a server boundary so S1 can revoke those column grants.
 *
 * Security: authentication and all reads use the cookie-bound client. The
 * implicit context RPC pins owner/staff scope to auth.uid(). An explicit
 * merchant header is validated, authorized through getMerchantForApiRequest,
 * and limited to a non-secret presentation projection.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE }
    );
  }

  const requestedMerchant = parseRequestedMerchantId(request);
  if (requestedMerchant.response) return requestedMerchant.response;

  try {
    if (requestedMerchant.merchantId) {
      const context = await getMerchantForApiRequest(supabase, user.id, {
        requestedMerchantId: requestedMerchant.merchantId,
      });
      if (!context) {
        return NextResponse.json(
          { error: 'Merchant not found' },
          { status: 404, headers: PRIVATE_NO_STORE }
        );
      }
      const { data: merchant, error } = await supabase
        .from('merchants')
        .select(
          'id, user_id, business_name, business_type, slug, country, payout_currency'
        )
        .eq('id', context.merchantId)
        .maybeSingle();
      if (error || !merchant) throw error ?? new Error('Merchant not found');

      return NextResponse.json(
        { merchant, staffAccess: context.staffAccess },
        { headers: PRIVATE_NO_STORE }
      );
    }

    const { merchant, primaryDomain, staffAccess } =
      await fetchDashboardMerchantContext(supabase);

    if (merchant && primaryDomain) {
      merchant.custom_domain = primaryDomain;
    }

    return NextResponse.json(
      { merchant, staffAccess },
      { headers: PRIVATE_NO_STORE }
    );
  } catch (error) {
    logger.error({
      message: 'Failed to resolve current merchant dashboard context',
      error: error instanceof Error ? error : new Error('Unknown error'),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: PRIVATE_NO_STORE }
    );
  }
}
