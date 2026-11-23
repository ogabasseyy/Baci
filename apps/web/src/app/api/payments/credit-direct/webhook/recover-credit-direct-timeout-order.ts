import type { SupabaseClient } from '@supabase/supabase-js';
import { reinstateTimeoutOrderPayment } from '@/lib/payments/reinstate-timeout-order-payment';

export type CreditDirectTimeoutRecoveryResult<T> =
  | { kind: 'blocked' }
  | { kind: 'committed_unread' }
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
  if (
    !transactionId ||
    (await reinstateTimeoutOrderPayment(
      supabase,
      orderId,
      transactionId,
      merchantId
    )) === 'blocked'
  ) {
    return { kind: 'blocked' };
  }

  const { data, error } = await supabase
    .from('orders')
    .select('notes')
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) {
    // The RPC has already committed. Let the caller file its reconciliation
    // review instead of returning a retryable webhook error.
    return { kind: 'committed_unread' };
  }

  let notes: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(data.notes ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      notes = { ...parsed };
    }
  } catch {
    // The existing replay flow reconciles missing fee evidence.
  }

  return { kind: 'recovered', response: await resume(notes) };
}
