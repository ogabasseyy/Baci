import { NextResponse } from 'next/server';
import { CUSTOMER_NAME_REQUIRED_MESSAGE } from '@/lib/customer-wallet-payment-account-types';
import type { CreateOrderWalletFundingIntentResult } from '@/lib/order-wallet-funding-intents';

function getFallbackStatus(code: string) {
  if (
    code === 'WALLET_DVA_DISABLED' ||
    code === 'WALLET_ORDER_AUTO_DEBIT_DISABLED'
  ) {
    return 403;
  }
  if (code === 'ORDER_NOT_FOUND') {
    return 404;
  }
  if (code === 'CUSTOMER_NAME_REQUIRED') {
    return 400;
  }
  if (code === 'WALLET_DVA_SETUP_FAILED') {
    return 502;
  }
  return 409;
}

export function formatIntentResult(
  result: CreateOrderWalletFundingIntentResult
) {
  if (result.kind === 'intent') {
    return NextResponse.json({
      account: {
        accountName: result.account.accountName,
        accountNumber: result.account.accountNumber,
        bankName: result.account.bankName,
        provider: result.account.provider,
      },
      intent: {
        currency: result.intent.currency,
        expectedAmount: result.intent.expectedAmount,
        expiresAt: result.intent.expiresAt,
        fundedAmount: result.intent.fundedAmount,
        id: result.intent.id,
        orderId: result.intent.orderId,
        status: result.intent.status,
        targetOrderAmount: result.intent.targetOrderAmount,
      },
    });
  }

  const body =
    result.code === 'CUSTOMER_NAME_REQUIRED'
      ? { ...result, error: CUSTOMER_NAME_REQUIRED_MESSAGE }
      : result;
  return NextResponse.json(body, { status: getFallbackStatus(result.code) });
}
