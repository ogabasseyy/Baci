import { redactEventDetails } from '@/lib/piggyvest/event-redaction';
import { attributedWalletId } from '@/lib/piggyvest/plan-wallet-restrictions';
import { outflowReferenceCandidates } from '@/lib/piggyvest/transfer-outbox';
import type { RecordPiggyvestEventInput } from '@/lib/piggyvest/webhook-inbox';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';

export function toRecordInput(
  event: PiggyvestWebhookEvent
): RecordPiggyvestEventInput {
  const base = {
    eventId: event.eventId,
    eventType: event.eventType,
    eventCategory: event.eventCategory,
    customerId: event.customer_id,
    details: redactEventDetails(event),
  };
  switch (event.eventType) {
    case 'bank-transfer.inflow.success':
      return {
        ...base,
        walletId: event.pvb_wallet,
        reference: event.pvb_reference,
        amountKobo: event.eventData.amount,
      };
    case 'interest-payout.success':
      return {
        ...base,
        // The credited plan wallet is the nested destination_wallet; the
        // envelope pvb_wallet is the source accrued-interest wallet.
        // Persist exactly the attribution the ledger acts on so a
        // redelivery reusing the event id with a different destination
        // surfaces as a conflict instead of a duplicate.
        walletId: event.eventData.destination_wallet,
        reference: event.pvb_reference,
        amountKobo: event.eventData.amount,
      };
    case 'create-wallet.success':
      return { ...base, walletId: event.pvb_wallet };
    case 'restriction-created.success':
    case 'restriction-lifted.success':
      // Persist exactly the attribution the processor acts on: without it,
      // a redelivery reusing the event id with a different wallet would
      // compare null-to-null, classify as a duplicate, and flip the wrong
      // wallet instead of quarantining as a conflict.
      return { ...base, walletId: attributedWalletId(event) };
    case 'bank-transfer.outflow.success':
    case 'bank-transfer.outflow.failed':
    case 'wallet-transfer.outflow.success': {
      // Same rule for the ordered reference candidates the outflow matcher
      // consumes: any change in set or order must surface as a conflict.
      const references = outflowReferenceCandidates(event.eventData);
      return {
        ...base,
        reference: references.length > 0 ? JSON.stringify(references) : null,
      };
    }
    default:
      return base;
  }
}
