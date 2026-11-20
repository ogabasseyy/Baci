import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { createServiceClient } from '@/lib/supabase/service';

export async function loadPaymentVerificationTransaction(
  reference: string,
  createClient: typeof createServiceClient
) {
  const supabase = createClient();

  const { data: transaction, error: transactionError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, amount, currency, status, gateway, gateway_reference, gateway_response, metadata, platform_fee'
    )
    .eq('gateway_reference', reference)
    .maybeSingle();

  if (transactionError) {
    // Transient: a failed lookup proves nothing about the reference
    // (outage, timeout), and native callers treat reference_not_found
    // as a permanent terminal failure that stops settlement polling.
    // A shopper whose payment was already captured must never be
    // prompted to pay again because the database hiccuped.
    logger.warn({
      message: 'Payment verification transaction lookup failed',
      reference: reference,
      error: transactionError,
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Verification unavailable' },
        { status: 503 }
      ),
    };
  }
  if (!transaction) {
    logger.warn({
      message: 'Payment verification reference not found',
      reference: reference,
    });
    // Permanent for this reference: no webhook or poll can materialize a
    // transaction row that the provider never created. The machine code
    // plus the echoed reference let native callers fail terminally
    // instead of confirming an unverifiable attempt as transient.
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: 'Transaction not found',
          code: 'reference_not_found',
          reference: reference,
        },
        { status: 404 }
      ),
    };
  }

  return { ok: true as const, supabase, transaction };
}
