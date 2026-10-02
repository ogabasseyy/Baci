export function remainingPaymentRefund(
  payment: { id: string; amount: number; gateway: string | null },
  refunds: Array<{
    amount: number;
    status: string;
    gateway?: string | null;
    metadata?: Record<string, unknown> | null;
  }>,
  paymentCount: number
): number {
  const paidKobo = Math.round(Number(payment.amount) * 100);
  if (!Number.isSafeInteger(paidKobo) || paidKobo <= 0)
    throw new Error('Invalid payment amount');
  let refundedKobo = 0;
  for (const refund of refunds) {
    if (
      refund.gateway &&
      ['wallet', 'savings', 'store_credit'].includes(refund.gateway)
    )
      continue;
    const linked = refund.metadata?.payment_transaction_id === payment.id;
    const legacyFull =
      !refund.metadata?.payment_transaction_id &&
      paymentCount === 1 &&
      refund.gateway === payment.gateway &&
      Number(refund.amount) === Number(payment.amount);
    if (
      !refund.metadata?.payment_transaction_id &&
      !legacyFull &&
      refund.status !== 'failed'
    )
      throw new Error('Unallocated refund requires review');
    if (!linked && !legacyFull) continue;
    if (!['completed', 'failed'].includes(refund.status))
      throw new Error('A previously accepted refund is still processing');
    if (refund.status === 'completed') {
      const amountKobo = Math.round(Number(refund.amount) * 100);
      if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0)
        throw new Error('Invalid refund amount');
      refundedKobo += amountKobo;
    }
  }
  if (refundedKobo > paidKobo)
    throw new Error('Refund ledger exceeds payment amount');
  return (paidKobo - refundedKobo) / 100;
}
