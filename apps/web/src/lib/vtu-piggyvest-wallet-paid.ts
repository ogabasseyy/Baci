/**
 * Airtime, data and bills paid from the PiggyVest main wallet (dark). The
 * row is prepared like a wallet-only checkout (a full wallet payment split,
 * which the intent claim requires) and marked with this payment source.
 * The customer's money is the confirmed PiggyVest payment, never the older
 * wallet: such a row is never debited from or refunded to store credit, and
 * is vended only by the checkout request that holds the payment's delivery
 * claim. A failure owes the refund to the PiggyVest wallet, which the wallet
 * pay ledger sends exactly once.
 */
export const PIGGYVEST_WALLET_PAYMENT_SOURCE = 'piggyvest_wallet';

/**
 * The metadata a checkout row paid from the PiggyVest wallet carries. Only
 * checkout rows (the wallet-only route) can be paid this way.
 */
export function piggyvestPaymentSourceMetadata(
  source: string,
  paymentMethod: 'store_credit' | 'piggyvest_wallet' | undefined
): { paymentSource?: typeof PIGGYVEST_WALLET_PAYMENT_SOURCE } {
  return source === 'checkout' && paymentMethod === 'piggyvest_wallet'
    ? { paymentSource: PIGGYVEST_WALLET_PAYMENT_SOURCE }
    : {};
}

export function isPiggyvestWalletPaid(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.paymentSource === PIGGYVEST_WALLET_PAYMENT_SOURCE;
}

/**
 * Records that this failed purchase is refunded to the PiggyVest wallet (the
 * wallet pay ledger opens that refund when the delivery is failed). Nothing
 * is credited to store credit.
 */
export function owePiggyvestWalletRefund(
  metadata: Record<string, unknown>,
  totalAmount: number
) {
  const before = JSON.stringify([
    metadata.refundIssued,
    metadata.refundAmount,
    metadata.refundDestination,
  ]);
  metadata.refundIssued = true;
  metadata.refundAmount = totalAmount;
  metadata.refundDestination = PIGGYVEST_WALLET_PAYMENT_SOURCE;
  return {
    metadataChanged:
      before !==
      JSON.stringify([
        metadata.refundIssued,
        metadata.refundAmount,
        metadata.refundDestination,
      ]),
    refundIssued: true,
    refundedAmount: totalAmount,
  };
}

/**
 * What a PiggyVest-paid row answers when it may not be vended here (no
 * delivery claim): a failed row stays failed (its refund goes to PiggyVest,
 * never a re-vend), anything else waits for the paying request.
 */
export function piggyvestWalletPaidHold(row: {
  amount: unknown;
  request_reference: string;
  status: string;
  error_message?: string | null;
}) {
  const amount = Number(row.amount) || 0;
  if (row.status === 'failed')
    return {
      amount,
      error:
        row.error_message ??
        'We could not complete this purchase. Your payment is going back to your PiggyVest wallet.',
      reference: row.request_reference,
      status: 'failed' as const,
    };
  return {
    amount,
    reference: row.request_reference,
    status: 'processing' as const,
  };
}
