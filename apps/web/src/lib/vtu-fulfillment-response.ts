import { NextResponse } from 'next/server';
import type { FulfilledVtuResult } from '@/lib/vtu-fulfillment';

/**
 * Maps a fulfilled VTU transaction to the wallet-only checkout HTTP
 * response: 400 + error on failure, 202 + reference on processing,
 * and the success payload (amount, cashback, reference, optional
 * loyalty points / voucher PIN) otherwise. Extracted from the
 * wallet-only route to keep that file under the 300-line modularity
 * budget.
 */
export function mapFulfillmentToResponse(fulfillment: FulfilledVtuResult) {
  if (fulfillment.status === 'failed') {
    return NextResponse.json(
      {
        error: fulfillment.error,
        reference: fulfillment.reference,
        ...(fulfillment.refundedToWallet !== undefined && {
          refundedToWallet: fulfillment.refundedToWallet,
        }),
      },
      { status: 400 }
    );
  }
  if (fulfillment.status === 'processing') {
    return NextResponse.json(
      { reference: fulfillment.reference, status: 'processing' },
      { status: 202 }
    );
  }
  return NextResponse.json({
    amount: fulfillment.amount,
    cashback: fulfillment.cashback,
    customerIdentifier: fulfillment.customerIdentifier,
    ...(fulfillment.loyaltyPoints && {
      loyaltyPoints: fulfillment.loyaltyPoints,
    }),
    reference: fulfillment.reference,
    status: 'successful',
    ...(fulfillment.voucherPin && { voucherPin: fulfillment.voucherPin }),
  });
}
