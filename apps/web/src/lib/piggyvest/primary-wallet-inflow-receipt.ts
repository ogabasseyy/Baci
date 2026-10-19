import 'server-only';
import { createHash } from 'node:crypto';
import { bankTransferInflowSuccessEventSchema } from '@/schemas/piggyvest/events';

export function preparePrimaryWalletInflowReceipt(input: unknown) {
  const parsed = bankTransferInflowSuccessEventSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid wallet inflow receipt');
  const event = parsed.data;
  const detail = event.eventData;
  if (detail.amount <= 0 || detail.customer_id !== event.customer_id)
    throw new Error('Invalid wallet inflow receipt');
  const financialIdentity = {
    providerTransactionId: detail.transaction_id,
    providerCustomerId: event.customer_id,
    providerWalletId: event.pvb_wallet,
    eventDataId: detail.id,
    amountKobo: detail.amount,
    feeKobo: detail.fee,
    currency: detail.currency,
    reference: detail.reference,
    sessionId: detail.session_id ?? null,
    creditedAt: new Date(detail.timestamp).toISOString(),
  };
  return {
    eventId: event.eventId,
    ...financialIdentity,
    financialFingerprint: createHash('sha256')
      .update(JSON.stringify(financialIdentity))
      .digest('hex'),
  };
}
