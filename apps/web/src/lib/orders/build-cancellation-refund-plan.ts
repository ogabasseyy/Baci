import { remainingPaymentRefund } from './remaining-payment-refund';

interface Payment {
  id: string;
  amount: number;
  gateway: string | null;
  gateway_reference: string | null;
}
interface Refund {
  amount: number;
  status: string;
  gateway?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function buildCancellationRefundPlan(
  payments: Payment[],
  refunds: Refund[],
  amountPaid: number
) {
  const paidKobo = Math.round(amountPaid * 100);
  if (!Number.isSafeInteger(paidKobo) || paidKobo <= 0)
    throw new Error('Invalid amount paid');
  if (
    new Set(payments.map((payment) => payment.gateway_reference)).size !==
    payments.length
  )
    throw new Error('Duplicate payment references require review');
  const plan = payments.map((transaction) => ({
    transaction,
    transactionAmount: remainingPaymentRefund(
      transaction,
      refunds,
      payments.length
    ),
  }));
  let totalKobo = plan.reduce(
    (sum, item) => sum + Math.round(item.transactionAmount * 100),
    0
  );
  for (const refund of refunds) {
    if (refund.status !== 'completed') continue;
    const refundKobo = Math.round(Number(refund.amount) * 100);
    if (!Number.isSafeInteger(refundKobo) || refundKobo <= 0)
      throw new Error('Invalid refund ledger amount');
    totalKobo += refundKobo;
  }
  if (!Number.isSafeInteger(totalKobo) || totalKobo > paidKobo)
    throw new Error('Refund plan exceeds amount paid');
  return plan;
}
