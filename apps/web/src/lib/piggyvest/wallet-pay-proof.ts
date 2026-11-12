import 'server-only';
import { z } from 'zod';
import { piggyvestProviderIdSchema } from '@/schemas/piggyvest-provider-id';
import { piggyvestTransactionStatusSchemas } from '@/schemas/piggyvest-transaction-status';
import { piggyvestWalletPaySchemas } from '@/schemas/piggyvest-wallet-pay';

// What any wallet-pay transfer (payment or refund) was reserved as.
const expectation = z.object({
  operationId: z.uuid(),
  amountKobo: piggyvestWalletPaySchemas.amountKobo,
  sourceWalletId: piggyvestProviderIdSchema,
  destinationWalletId: piggyvestProviderIdSchema,
  reference: piggyvestWalletPaySchemas.reference,
  businessId: piggyvestProviderIdSchema,
  providerCustomerId: piggyvestProviderIdSchema,
});

export interface WalletPaySettlementProof {
  operationId: string;
  providerTransactionId: string;
  reference: string;
  amountKobo: number;
  sourceWalletId: string;
  destinationWalletId: string;
  businessId: string;
  feeKobo: number;
}

export type WalletPayProofResult =
  | { status: 'unverified' }
  | { status: 'verified' | 'failed'; proof: WalletPaySettlementProof };

/**
 * Binds a full TSQ record to what we reserved, with the same rules as the
 * savings proof (primary-wallet-savings-proof.ts): our reference in
 * third_party_reference, the exact amount, both wallets, the provider id
 * echoed as internal_reference, the business (and, when sent, the customer or
 * business in customer_id), and a terminal status. Unlike savings, a non-zero
 * fee does NOT leave the record unverified forever: it is passed through and
 * the database records the transfer for review instead of settling it clean
 * (the fee for customer-to-business transfers is unconfirmed).
 */
export function verifyWalletPayProof(
  storedReservation: unknown,
  providerResponse: unknown
): WalletPayProofResult {
  const reserved = expectation.safeParse(storedReservation);
  if (!reserved.success) return { status: 'unverified' };
  const expected = reserved.data;
  const parsed =
    piggyvestTransactionStatusSchemas.walletTransferResponse.safeParse(
      providerResponse
    );
  if (!parsed.success) return { status: 'unverified' };
  const actual = parsed.data.data;
  const terminal =
    actual.status === 'successful' || actual.status === 'failed'
      ? actual.status
      : null;
  if (
    terminal === null ||
    actual.internal_reference !== actual.id ||
    actual.amount !== expected.amountKobo ||
    actual.third_party_reference !== expected.reference ||
    actual.source_wallet !== expected.sourceWalletId ||
    actual.destination_wallet !== expected.destinationWalletId ||
    (actual.customer_id !== expected.providerCustomerId &&
      actual.customer_id !== expected.businessId) ||
    (actual.business_id !== undefined &&
      actual.business_id !== expected.businessId)
  )
    return { status: 'unverified' };
  return {
    status: terminal === 'successful' ? 'verified' : 'failed',
    proof: {
      operationId: expected.operationId,
      providerTransactionId: actual.id,
      reference: expected.reference,
      amountKobo: expected.amountKobo,
      sourceWalletId: expected.sourceWalletId,
      destinationWalletId: expected.destinationWalletId,
      businessId: expected.businessId,
      feeKobo: actual.fee,
    },
  };
}
