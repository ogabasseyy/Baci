import 'server-only';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';

/**
 * Redacted event-detail projections for durable storage (inbox replay
 * column, quarantine detail).
 *
 * Inflow payloads carry bank account numbers/names, sender names,
 * narrations and IP addresses. Those fields are allowlisted OUT: storage
 * keeps only the reconciliation identity (event/transaction/reference/
 * session ids, wallet ids, amounts, currency, timestamps). Event types
 * with unpublished shapes contribute envelope fields only — unknown
 * detail is never passed through, because an unknown shape may carry PII.
 */

function baseEnvelope(event: PiggyvestWebhookEvent): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    eventId: event.eventId,
    eventType: event.eventType,
    eventCategory: event.eventCategory,
    customer_id: event.customer_id,
  };
  if ('pvb_reference' in event) {
    envelope.pvb_reference = event.pvb_reference;
  }
  if ('pvb_wallet' in event && typeof event.pvb_wallet === 'string') {
    envelope.pvb_wallet = event.pvb_wallet;
  }
  return envelope;
}

export function redactEventDetails(
  event: PiggyvestWebhookEvent
): Record<string, unknown> {
  const redacted = baseEnvelope(event);
  if (event.eventType === 'bank-transfer.inflow.success') {
    const detail = event.eventData;
    Object.assign(redacted, {
      event_data_id: detail.id,
      transaction_id: detail.transaction_id,
      reference: detail.reference,
      session_id: detail.session_id,
      internal_reference: detail.internal_reference,
      initiator_reference: detail.initiator_reference,
      third_party_reference: detail.third_party_reference,
      destination_wallet_id: detail.destination_wallet_id,
      amount: detail.amount,
      fee: detail.fee,
      currency: detail.currency,
      timestamp: detail.timestamp,
      status: detail.status,
    });
    return redacted;
  }
  if (event.eventType === 'interest-payout.success') {
    const detail = event.eventData;
    Object.assign(redacted, {
      payout_id: detail.id,
      reference: detail.reference,
      batch_id: detail.batch_id,
      destination_wallet: detail.destination_wallet,
      amount: detail.amount,
      gross_interest_payout: detail.break_down.gross_interest_payout,
      withholding_tax: detail.break_down.withholding_tax,
      net_interest_payout: detail.break_down.net_interest_payout,
      timestamp: detail.timestamp,
      pvb_accrued_interest_wallet: event.pvb_accrued_interest_wallet,
    });
    return redacted;
  }
  return redacted;
}
