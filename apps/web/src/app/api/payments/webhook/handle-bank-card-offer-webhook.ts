import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';
import { bankCardOfferWebhookTransactionSchema } from '@/schemas/bank-card-offer-webhook-transaction';

export async function handleBankCardOfferWebhook({
  gateway,
  reference,
  supabase,
  finalize,
}: {
  gateway: string;
  reference: string;
  supabase: SupabaseClient;
  finalize: typeof finalizeOrderGatewayPayment;
}) {
  if (
    gateway !== 'paystack' ||
    !bankCardOfferReferenceSchema.safeParse(reference).success
  ) {
    return NextResponse.json(
      { error: 'Invalid bank offer capture' },
      { status: 400 }
    );
  }
  const row = await supabase.rpc('get_bank_card_offer_webhook_transaction', {
    p_reference: reference,
  });
  if (row.error) {
    return NextResponse.json(
      { error: 'Bank offer capture lookup unavailable' },
      { status: 503 }
    );
  }
  if (!row.data) {
    // The saved attempt is the authority for tenant and order identity.
    // Without a match, operations reconcile this reference in the
    // platform queue. Paystack metadata cannot assign it to a tenant.
    const { error } = await supabase.from('reconciliation_review').insert({
      issue_type: 'payment_match_zero_candidates',
      paystack_ref: reference,
      reason:
        'Signed bank-offer charge webhook did not match a saved payment attempt',
      metadata: { source: 'bank_card_offer_webhook' },
    });
    if (error && error.code !== '23505') {
      return NextResponse.json(
        { error: 'Payment reconciliation review unavailable' },
        { status: 503 }
      );
    }
    return NextResponse.json({
      code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
      status: 'pending',
    });
  }
  const match = bankCardOfferWebhookTransactionSchema.safeParse(row.data);
  if (!match.success || match.data.gateway_reference !== reference) {
    return NextResponse.json(
      { error: 'Invalid bank offer capture' },
      { status: 400 }
    );
  }
  const transaction = match.data;
  const outcome = await finalize({
    actor: `webhook:${reference}`,
    gateway,
    orderId: transaction.order_id,
    reference,
    scheduleAfter: (task) => after(task),
    supabase,
    transaction: {
      amount: transaction.amount,
      gateway_reference: transaction.gateway_reference ?? null,
      id: transaction.id,
      merchant_id: transaction.merchant_id,
      order_id: transaction.order_id,
      platform_fee: transaction.platform_fee,
    },
  });
  if (outcome.kind === 'bank_offer_terminal') {
    return NextResponse.json({
      code: 'BANK_CARD_OFFER_TERMINAL_REVIEW',
      status: outcome.status,
    });
  }
  if (outcome.kind === 'bank_offer_capture_review') {
    // Acknowledge provider delivery after saving the review. The customer
    // verify endpoint returns 202 for the same pending payment.
    return NextResponse.json({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
      status: 'pending',
    });
  }
  if (
    outcome.kind === 'completed' ||
    outcome.kind === 'order_cancelled' ||
    outcome.kind === 'order_skipped'
  ) {
    return NextResponse.json({ success: true, outcome: outcome.kind });
  }
  return NextResponse.json(
    { error: 'Bank offer capture requires reconciliation' },
    { status: 503 }
  );
}
