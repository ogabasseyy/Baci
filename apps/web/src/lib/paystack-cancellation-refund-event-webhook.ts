import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { reconcilePaystackRefundEvent } from '@/lib/payments/reconcile-paystack-cancellation-refunds';

export async function handlePaystackCancellationRefundEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
) {
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null;
  const transactionReference = data?.transaction_reference;
  if (typeof transactionReference === 'string') {
    try {
      await reconcilePaystackRefundEvent(supabase, transactionReference);
    } catch (error) {
      logger.error({
        message: 'Paystack refund reconciliation failed',
        error,
      });
      return NextResponse.json(
        { error: 'Refund reconciliation unavailable' },
        { status: 503 }
      );
    }
  }
  return NextResponse.json({ message: 'Refund event reconciled' });
}
