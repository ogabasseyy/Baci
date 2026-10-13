import { NextResponse } from 'next/server';
import type { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-accounts';

/**
 * Maps a customer-wallet payment-account error code to its HTTP status.
 * Unknown codes fall back to 500 so a new failure mode never leaks a 2xx.
 */
export function walletAccountErrorStatus(code: string) {
  if (code === 'CUSTOMER_NAME_REQUIRED' || code === 'CUSTOMER_PHONE_REQUIRED') {
    return 400;
  }

  if (
    code === 'GATEWAY_NOT_CONFIGURED' ||
    code === 'WALLET_DVA_DISABLED_ACCOUNT' ||
    code === 'WALLET_DVA_ORDER_ALIAS_CONFLICT' ||
    code === 'WALLET_DVA_PENDING_REVIEW_CONFLICT' ||
    code === 'WALLET_DVA_SUBACCOUNT_CONFLICT'
  ) {
    return 409;
  }

  if (code === 'PAYSTACK_CUSTOMER_ERROR' || code === 'PAYSTACK_DVA_ERROR') {
    return 502;
  }

  return 500;
}

export function walletAccountErrorResponse(
  error: CustomerWalletPaymentAccountError
) {
  // Storage failures carry raw Postgres text (e.g. unique-constraint detail
  // after a retried create) — never show that to shoppers; the raw message
  // stays in server logs via the route's console.error.
  const message =
    error.code === 'WALLET_DVA_STORAGE_ERROR'
      ? 'We could not save your transfer account. Please try again.'
      : error.message;
  return NextResponse.json(
    { error: message, code: error.code },
    { status: walletAccountErrorStatus(error.code) }
  );
}
