import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { maskPayoutAccountNumber } from './payout-account-mask';

/**
 * Manual withdrawal dispatch stays fail-closed until the payout worker can
 * atomically reserve funds and reconcile the provider outcome. The wallet UI
 * already advertises withdrawals as disabled; this guard prevents callers from
 * bypassing that product state through the API.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { valid: csrfValid, response: csrfResponse } =
    await checkCsrfProtection(request);
  if (!csrfValid) {
    return (
      csrfResponse ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id);
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(toUserAccess(merchantContext), 'settings', 'edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    {
      code: 'payouts_unavailable',
      error: 'Manual payouts are temporarily unavailable',
    },
    { status: 503 }
  );
}

export async function GET(_request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id);
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(toUserAccess(merchantContext), 'settings', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // payout_requests is owner-RLS scoped. Do not return a misleading empty
  // ledger to staff until an authorized staff payout-history projection exists.
  if (merchantContext.staffAccess.isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: payouts, error } = await supabase
    .from('payout_requests')
    .select(
      'id, amount, currency, status, bank_name, bank_account_name, bank_account_number, korapay_reference, requested_at, processed_at, completed_at, created_at'
    )
    .eq('merchant_id', merchantContext.merchantId)
    .order('created_at', { ascending: false });
  if (error) {
    logger.error({
      message: 'Failed to fetch payouts',
      merchantId: merchantContext.merchantId,
      errorCode: error.code,
      errorMessage: error.message,
    });
    return NextResponse.json(
      { error: 'Failed to fetch payouts' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    payouts: (payouts ?? []).map((payout) => ({
      id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      status: payout.status,
      bankName: payout.bank_name,
      bankAccountName: payout.bank_account_name,
      bankAccountNumber: maskPayoutAccountNumber(payout.bank_account_number),
      reference: payout.korapay_reference,
      requestedAt: payout.requested_at,
      processedAt: payout.processed_at,
      completedAt: payout.completed_at,
      createdAt: payout.created_at,
    })),
  });
}
