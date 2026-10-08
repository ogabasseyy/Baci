import { NextResponse } from 'next/server';
import type { RedvaultOrderQuote } from './compute-redvault-order-quote';
import { validateRedvaultLivePilotOrder } from './redvault-live-pilot';
import { getRedvaultPaymentAvailability } from './redvault-payment-availability';

// Pilot gate for order creation, extracted from the orders route so the
// high-risk handler stays a thin wiring layer: policy detection, fee
// aggregation, validation wiring, and the 409 mapping all live here.
export function rejectDisallowedRedvaultLivePilotOrder(input: {
  redvaultRequested: boolean;
  redvaultQuote: RedvaultOrderQuote | null;
  userId: string | null;
  merchantId: string;
  currency: string;
  shippingFee: number;
  wrappingFee: number;
  orderItems: ReadonlyArray<{ assurance_fee: number }>;
  useWalletCredit: boolean;
  walletAmount: unknown;
  useSavingsCredit: boolean;
  savingsAmount: unknown;
  taxAmount: number;
}): NextResponse | null {
  if (
    !input.redvaultRequested ||
    !input.redvaultQuote ||
    getRedvaultPaymentAvailability().reason !== 'private_live_pilot'
  ) {
    return null;
  }
  const allowed = validateRedvaultLivePilotOrder({
    userId: input.userId,
    merchantId: input.merchantId,
    currency: input.currency,
    items: input.redvaultQuote.lines,
    subtotalKobo: input.redvaultQuote.productSubtotalKobo,
    discountKobo: input.redvaultQuote.discountKobo,
    shippingFee: input.shippingFee,
    assuranceAmount: input.orderItems.reduce(
      (sum, item) => sum + item.assurance_fee,
      0
    ),
    wrappingFee: input.wrappingFee,
    walletAmount: Number(input.useWalletCredit ? input.walletAmount : 0),
    savingsAmount: Number(input.useSavingsCredit ? input.savingsAmount : 0),
    taxAmountKobo: Math.round(input.taxAmount * 100),
  });
  if (allowed) {
    return null;
  }
  return NextResponse.json(
    {
      code: 'REDVAULT_PILOT_UNAVAILABLE',
      error: 'REDVAULT is unavailable',
    },
    { status: 409, headers: { 'Cache-Control': 'no-store' } }
  );
}
