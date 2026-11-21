import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  reversalTransactionReference,
  webhookObject,
} from '@/lib/piggyvest/primary-wallet-card-checkout-webhook-shape';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';

export async function handleBankCardOfferDispute(
  event: unknown,
  data: unknown,
  getClient: () => Pick<SupabaseClient, 'rpc'>
): Promise<Response | null> {
  if (event !== 'charge.dispute.create' && event !== 'charge.dispute.resolve') {
    return null;
  }
  const payload = webhookObject(data);
  const reference = bankCardOfferReferenceSchema.safeParse(
    payload && reversalTransactionReference(payload)
  );
  if (!reference.success) return null;

  const rawId = payload?.id;
  const disputeId =
    typeof rawId === 'string'
      ? rawId
      : typeof rawId === 'number' && Number.isSafeInteger(rawId)
        ? String(rawId)
        : '';
  if (!/^[0-9]{1,32}$/.test(disputeId)) {
    return NextResponse.json(
      { error: 'Bank offer dispute ID unavailable' },
      { status: 503 }
    );
  }

  let outcome = 'open';
  if (event === 'charge.dispute.resolve') {
    if (payload?.status === 'resolved' && payload.resolution === 'declined')
      outcome = 'won';
    else if (payload?.resolution === 'merchant-accepted') outcome = 'lost';
  }

  const result = await getClient().rpc('record_bank_card_offer_dispute', {
    p_dispute_id: disputeId,
    p_event: event,
    p_outcome: outcome,
    p_reference: reference.data,
  });
  if (result.error || result.data !== true) {
    return NextResponse.json(
      { error: 'Bank offer dispute reconciliation unavailable' },
      { status: 503 }
    );
  }
  return NextResponse.json({ code: 'BANK_CARD_OFFER_DISPUTE_REVIEW' });
}
