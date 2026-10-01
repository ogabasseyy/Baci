import { NextResponse } from 'next/server';
import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';

export function validateRedvaultRequest(input: {
  merchantId: string;
  hasVoucherItem: boolean;
  discountCode?: string;
  useWallet?: boolean;
  useSavings?: boolean;
  idempotencyKey: string | null;
}) {
  if (input.merchantId !== OGABASSEY_MERCHANT_ID) {
    return NextResponse.json(
      {
        code: 'REDVAULT_MERCHANT_FORBIDDEN',
        error: 'REDVAULT is unavailable for this store',
      },
      { status: 403 }
    );
  }
  if (
    input.hasVoucherItem ||
    input.discountCode ||
    input.useWallet ||
    input.useSavings
  ) {
    return NextResponse.json(
      {
        code: 'REDVAULT_COMBINATION_UNSUPPORTED',
        error: 'This REDVAULT combination is not supported',
      },
      { status: 400 }
    );
  }
  if (!input.idempotencyKey?.trim()) {
    return NextResponse.json(
      {
        code: 'REDVAULT_IDEMPOTENCY_KEY_REQUIRED',
        error: 'A checkout idempotency key is required',
      },
      { status: 400 }
    );
  }
  return null;
}
