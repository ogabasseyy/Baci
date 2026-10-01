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
    code === 'WALLET_DVA_ORDER_ALIAS_CONFLICT' ||
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
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: walletAccountErrorStatus(error.code) }
  );
}
