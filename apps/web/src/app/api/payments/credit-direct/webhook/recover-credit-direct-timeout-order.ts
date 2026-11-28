import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { reinstateTimeoutOrderPayment } from '@/lib/payments/reinstate-timeout-order-payment';

export type CreditDirectTimeoutRecoveryResult<T> =
  | { kind: 'blocked' }
  | { kind: 'review_required' }
  | { kind: 'recovered'; response: T };

export async function recoverCreditDirectTimeoutOrder<T>({
  merchantId,
  orderId,
  resume,
  supabase,
  transactionId,
}: {
  merchantId: string;
  orderId: string;
  resume: (notes: Record<string, unknown>) => Promise<T>;
  supabase: SupabaseClient;
  transactionId: string | null;
}): Promise<CreditDirectTimeoutRecoveryResult<T>> {
  if (!transactionId) {
    return { kind: 'blocked' };
  }

  let reinstatement: Awaited<ReturnType<typeof reinstateTimeoutOrderPayment>>;
  try {
    reinstatement = await reinstateTimeoutOrderPayment(
      supabase,
      orderId,
      transactionId,
      merchantId
    );
  } catch (error) {
    logger.error({
      error,
      message: 'Credit Direct late payment reinstatement failed',
      orderId,
      transactionId,
    });
    return { kind: 'review_required' };
  }
  if (reinstatement === 'blocked') return { kind: 'blocked' };

  let data: {
    cancelled_at: string | null;
    notes: string | null;
    paid_transaction_id: string | null;
    payment_status: string | null;
    shipping_status: string | null;
  } | null = null;
  let error: unknown;
  for (let attempt = 0; attempt < 2 && !data; attempt += 1) {
    const result = await supabase
      .from('orders')
      .select(
        'notes, payment_status, shipping_status, cancelled_at, paid_transaction_id'
      )
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    logger.error({
      error,
      message: 'Credit Direct reinstated order notes remained unavailable',
      orderId,
      transactionId,
    });
    // The RPC has already committed. Let the caller file its reconciliation
    // review instead of returning a retryable webhook error.
    return { kind: 'review_required' };
  }

  if (
    data.payment_status !== 'paid' ||
    data.cancelled_at !== null ||
    data.paid_transaction_id !== transactionId ||
    ['cancelled', 'canceled'].includes(data.shipping_status ?? '')
  ) {
    return { kind: 'review_required' };
  }

  let notes: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(data.notes ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      notes = { ...parsed };
    }
  } catch {
    // Without a valid split, the caller must file review and stop replay work.
  }

  const platformFee = readFeeAmount(notes.platformFee);
  const merchantAmount = readFeeAmount(notes.merchantAmount);
  if (
    platformFee === null ||
    merchantAmount === null ||
    platformFee < 0 ||
    merchantAmount <= 0
  ) {
    return { kind: 'review_required' };
  }

  return { kind: 'recovered', response: await resume(notes) };
}

function readFeeAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const amount = Number(value.trim());
  return Number.isFinite(amount) ? amount : null;
}
