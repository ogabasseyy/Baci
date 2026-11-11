interface StoreCreditProjectionClient {
  rpc(
    name: 'record_order_store_credit',
    args: { p_order_id: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const reconciliationFailure = {
  status: 409,
  code: 'STORE_CREDIT_REVIEW_REQUIRED',
  message: 'Store credit requires payment review.',
} as const;

const contentionFailure = {
  status: 503,
  code: 'STORE_CREDIT_RETRY_REQUIRED',
  message: 'Store credit is temporarily busy. Retry the same order shortly.',
} as const;

/** Confirm the durable debit before any provider can charge the residual. */
export async function recordPreGatewayRedemption(
  orderId: string,
  orderTotal: number,
  savingsAmountUsed: number,
  walletAmountUsed: number,
  supabase: StoreCreditProjectionClient
) {
  if (savingsAmountUsed === 0 && walletAmountUsed === 0) return;
  const failure = 'Store credit could not be confirmed';
  if (
    ![orderTotal, savingsAmountUsed, walletAmountUsed].every(Number.isFinite) ||
    orderTotal <= 0 ||
    savingsAmountUsed < 0 ||
    walletAmountUsed < 0 ||
    savingsAmountUsed + walletAmountUsed > orderTotal
  )
    return reconciliationFailure;

  const { data, error } = await supabase.rpc('record_order_store_credit', {
    p_order_id: orderId,
  });
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === '23514') return reconciliationFailure;
    if (error.code === '40001') {
      const needsReview =
        'message' in error &&
        error.message === 'Store credit reconciliation required';
      return needsReview ? reconciliationFailure : contentionFailure;
    }
  }
  if (error) throw new Error(failure);
  const credit: unknown = data;
  if (
    !credit ||
    typeof credit !== 'object' ||
    !('wallet' in credit) ||
    !('savings' in credit) ||
    Number(credit.wallet) !== walletAmountUsed ||
    Number(credit.savings) !== savingsAmountUsed
  )
    return reconciliationFailure;
}
