import type { SupabaseClient } from '@supabase/supabase-js';
import { reinstateTimeoutOrderPayment } from '@/lib/payments/reinstate-timeout-order-payment';

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
}): Promise<T | null> {
  if (
    !transactionId ||
    (await reinstateTimeoutOrderPayment(
      supabase,
      orderId,
      transactionId,
      merchantId
    )) === 'blocked'
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from('orders')
    .select('notes')
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .single();

  if (error || !data) {
    throw new Error('Unable to load reinstated Credit Direct order', {
      cause: error,
    });
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

  return resume(notes);
}
