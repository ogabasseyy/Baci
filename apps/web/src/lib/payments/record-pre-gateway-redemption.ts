interface StoreCreditProjectionClient {
  rpc(
    name: 'record_order_store_credit',
    args: { p_order_id: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Confirm the durable debit before any provider can charge the residual. */
export async function recordPreGatewayRedemption(
  orderId: string,
  orderTotal: number,
  savingsAmountUsed: number,
  walletAmountUsed: number,
  supabase: StoreCreditProjectionClient
): Promise<void> {
  if (savingsAmountUsed === 0 && walletAmountUsed === 0) return;
  const failure = 'Store credit could not be confirmed';
  if (
    ![orderTotal, savingsAmountUsed, walletAmountUsed].every(Number.isFinite) ||
    orderTotal <= 0 ||
    savingsAmountUsed < 0 ||
    walletAmountUsed < 0 ||
    savingsAmountUsed + walletAmountUsed > orderTotal
  )
    throw new Error(failure);

  const { data, error } = await supabase.rpc('record_order_store_credit', {
    p_order_id: orderId,
  });
  const credit: unknown = data;
  if (
    error ||
    !credit ||
    typeof credit !== 'object' ||
    !('wallet' in credit) ||
    !('savings' in credit) ||
    Number(credit.wallet) !== walletAmountUsed ||
    Number(credit.savings) !== savingsAmountUsed
  )
    throw new Error(failure);
}
