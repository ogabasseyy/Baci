import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';

const disputeObjectSchema = z.record(z.string(), z.unknown());

export async function handleBankCardOfferDispute(
  event: unknown,
  data: unknown,
  getClient: () => Pick<SupabaseClient, 'rpc'>
): Promise<Response | null> {
  if (event !== 'charge.dispute.create' && event !== 'charge.dispute.resolve') {
    return null;
  }
  const parsed = disputeObjectSchema.safeParse(data);
  if (!parsed.success) return null;
  const payload = parsed.data;
  // Paystack's Dispute API shows transaction_reference may be null while
  // transaction.reference identifies the payment. Keep the abbreviated
  // transaction_ref field for existing webhook deliveries.
  const transaction = disputeObjectSchema.safeParse(payload.transaction);
  const references = [
    transaction.data?.reference,
    payload.transaction_reference,
    payload.transaction_ref,
  ].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const reference = references.find(
    (value) => bankCardOfferReferenceSchema.safeParse(value).success
  );
  if (!reference) return null;
  if (references.some((value) => value !== reference)) {
    return NextResponse.json(
      { error: 'Conflicting bank offer dispute references' },
      { status: 503 }
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
    return NextResponse.json(
      { error: 'Bank offer dispute ID unavailable' },
      { status: 503 }
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
