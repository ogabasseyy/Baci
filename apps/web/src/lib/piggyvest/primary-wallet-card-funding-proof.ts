import 'server-only';
import { primaryWalletCardFundingSchemas as schemas } from '@/schemas/primary-wallet-card-funding';

export function verifyPrimaryWalletCardFundingProof(input: {
  reservation: unknown;
  collection: unknown;
  transfer: unknown;
}) {
  const reservation = schemas.reservation.safeParse(input.reservation);
  const collection = schemas.collection.safeParse(input.collection);
  if (!reservation.success || !collection.success)
    return { status: 'reconciliation_required' as const };
  if (collection.data.outcome === 'pending')
    return { status: 'collection_pending' as const };
  if (collection.data.outcome !== 'verified')
    return { status: 'reconciliation_required' as const };
  const expected = reservation.data;
  const collected = collection.data.collection;
  if (
    collected.intentId !== expected.intentId ||
    collected.reference !== expected.collectionReference ||
    collected.amountKobo !== expected.amountKobo ||
    collected.currency !== expected.currency ||
    collected.authorization.email !== expected.email
  )
    return { status: 'reconciliation_required' as const };
  if (input.transfer === null) return { status: 'custody_pending' as const };
  const transfer = schemas.transfer.safeParse(input.transfer);
  if (!transfer.success) return { status: 'reconciliation_required' as const };
  const actual = transfer.data.data;
  if (
    actual.reference !== expected.transferReference ||
    actual.amount !== expected.amountKobo ||
    actual.currency !== expected.currency ||
    actual.business_id !== expected.businessId ||
    actual.source_wallet !== expected.sourceWalletId ||
    actual.destination_wallet !== expected.destinationWalletId ||
    actual.destination_customer_id !== expected.destinationCustomerId ||
    (actual.fee !== undefined && actual.fee !== 0)
  )
    return { status: 'reconciliation_required' as const };
  return {
    status: 'ready_to_credit' as const,
    proof: {
      ...expected,
      collectionTransactionId: collected.providerTransactionId,
      transferTransactionId: actual.id,
    },
  };
}
