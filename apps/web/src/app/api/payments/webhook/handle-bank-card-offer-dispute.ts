import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';
import { paystackDisputeObjectSchema } from '@/schemas/paystack-dispute-object';

type DisputeClient = Pick<SupabaseClient, 'from' | 'rpc'>;

async function reviewMalformedDispute(
  client: DisputeClient,
  event: string,
  references: string[],
  reason: string
) {
  // Conflicting payloads cannot attribute a dispute to an order. Keep a
  // reference-only review for each candidate before acknowledging Paystack.
  const writes = await Promise.all(
    references.map((reference) =>
      client.from('reconciliation_review').insert({
        issue_type: 'payment_match_ambiguous',
        paystack_ref: reference,
        reason,
        metadata: { source: 'bank_card_offer_dispute_payload', event },
      })
    )
  );
  if (writes.some(({ error }) => error && error.code !== '23505')) {
    return NextResponse.json(
      { error: 'Bank offer dispute reconciliation unavailable' },
      { status: 503 }
    );
  }
  return NextResponse.json({ code: 'BANK_CARD_OFFER_DISPUTE_REVIEW' });
}

export async function handleBankCardOfferDispute(
  event: unknown,
  data: unknown,
  getClient: () => DisputeClient
): Promise<Response | null> {
  if (event !== 'charge.dispute.create' && event !== 'charge.dispute.resolve') {
    return null;
  }
  const parsed = paystackDisputeObjectSchema.safeParse(data);
  if (!parsed.success) return null;
  const payload = parsed.data;
  // Paystack's Dispute API shows transaction_reference may be null while
  // transaction.reference identifies the payment. Keep the abbreviated
  // transaction_ref field for existing webhook deliveries.
  const transaction = paystackDisputeObjectSchema.safeParse(
    payload.transaction
  );
  const references = [
    transaction.data?.reference,
    payload.transaction_reference,
    payload.transaction_ref,
  ].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const candidates = [
    ...new Set(
      references.filter(
        (value) => bankCardOfferReferenceSchema.safeParse(value).success
      )
    ),
  ];
  const [reference] = candidates;
  if (!reference) return null;
  if (references.some((value) => value !== reference)) {
    return reviewMalformedDispute(
      getClient(),
      event,
      candidates,
      'Conflicting bank offer dispute references'
    );
  }

  const rawId = payload.id;
  const disputeId =
    typeof rawId === 'string'
      ? rawId
      : typeof rawId === 'number' && Number.isSafeInteger(rawId)
        ? String(rawId)
        : '';
  if (!/^[0-9]{1,32}$/.test(disputeId)) {
    return reviewMalformedDispute(
      getClient(),
      event,
      candidates,
      'Bank offer dispute ID unavailable'
    );
  }

  let outcome = 'open';
  if (event === 'charge.dispute.resolve' && payload.status === 'resolved') {
    if (payload.resolution === 'declined') outcome = 'won';
    else if (payload.resolution === 'merchant-accepted') outcome = 'lost';
  }

  const result = await getClient().rpc('record_bank_card_offer_dispute', {
    p_dispute_id: disputeId,
    p_event: event,
    p_outcome: outcome,
    p_reference: reference,
  });
  if (result.error || result.data !== true) {
    return NextResponse.json(
      { error: 'Bank offer dispute reconciliation unavailable' },
      { status: 503 }
    );
  }
  return NextResponse.json({ code: 'BANK_CARD_OFFER_DISPUTE_REVIEW' });
}
