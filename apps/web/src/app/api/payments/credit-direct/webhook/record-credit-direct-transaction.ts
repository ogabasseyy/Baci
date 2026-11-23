import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreditDirectWebhookPayload } from '@/lib/credit-direct';
import { logger } from '@/lib/logger';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type RecordCreditDirectTransactionResult =
  | { kind: 'error' }
  | { kind: 'recorded'; transactionId: string | null; created: boolean };

/** Persist one completed provider capture, recovering its ID after an insert race. */
export async function recordCreditDirectTransaction({
  amount,
  gatewayReference,
  gatewayResponse,
  merchantId,
  merchantAmount,
  orderId,
  platformFee,
  supabase,
}: {
  amount: number;
  gatewayReference: string;
  gatewayResponse: CreditDirectWebhookPayload;
  merchantId: string;
  merchantAmount: number;
  orderId: string;
  platformFee: number;
  supabase: SupabaseClient;
}): Promise<RecordCreditDirectTransactionResult> {
  const { data: existingTx, error: existingTxError } = await supabase
    .from('transactions')
    .select('id, merchant_id, order_id')
    .eq('gateway_reference', gatewayReference)
    .eq('gateway', 'credit_direct')
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (existingTxError) {
    logger.error({
      message: 'Failed to look up existing Credit Direct transaction',
      error: existingTxError,
      orderId,
      transactionId: gatewayReference,
    });
    return { kind: 'error' };
  }

  if (existingTx) {
    if (
      existingTx.order_id !== orderId ||
      existingTx.merchant_id !== merchantId
    ) {
      logger.error({
        message:
          'Credit Direct provider reference is already bound to another order',
        orderId,
        transactionId: gatewayReference,
      });
      return { kind: 'error' };
    }
    logger.info({
      message: 'Credit Direct transaction already processed (idempotent)',
      transactionId: gatewayReference,
      existingTxId: existingTx.id,
    });
    return { created: false, kind: 'recorded', transactionId: existingTx.id };
  }

  const { data: insertedTx, error: txError } = await supabase
    .from('transactions')
    .insert({
      merchant_id: merchantId,
      order_id: orderId,
      transaction_type: 'payment',
      amount,
      currency: 'NGN',
      status: 'completed',
      gateway: 'credit_direct',
      gateway_reference: gatewayReference,
      gateway_response: gatewayResponse,
      platform_fee: platformFee,
      merchant_amount: merchantAmount,
    })
    .select('id')
    .single();

  if (txError?.code === POSTGRES_UNIQUE_VIOLATION) {
    logger.info({
      message:
        'Credit Direct transaction insert raced a concurrent delivery (unique violation)',
      orderId,
      transactionId: gatewayReference,
    });
    const { data: racedTx, error: racedTxError } = await supabase
      .from('transactions')
      .select('id, merchant_id, order_id')
      .eq('gateway_reference', gatewayReference)
      .eq('gateway', 'credit_direct')
      .eq('merchant_id', merchantId)
      .maybeSingle();

    if (
      racedTxError ||
      !racedTx ||
      racedTx.order_id !== orderId ||
      racedTx.merchant_id !== merchantId
    ) {
      logger.error({
        message: 'Unable to load the winning Credit Direct transaction insert',
        error: racedTxError,
        orderId,
        transactionId: gatewayReference,
      });
      return { kind: 'error' };
    }

    return {
      created: false,
      kind: 'recorded',
      transactionId: racedTx.id,
    };
  }

  if (txError) {
    logger.error({
      message: 'Failed to create transaction record',
      error: txError,
      orderId,
      transactionId: gatewayReference,
    });
    return { kind: 'error' };
  }

  return {
    created: true,
    kind: 'recorded',
    transactionId: insertedTx?.id ?? null,
  };
}
