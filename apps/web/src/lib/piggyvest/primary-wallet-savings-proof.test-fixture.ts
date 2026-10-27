import { verifyPrimaryWalletSavingsProof as verifySavingsProof } from './primary-wallet-savings-proof';

export const reservation = {
  operationId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  amountKobo: 10000,
  sourceWalletId: 'source-wallet',
  destinationWalletId: 'savings-wallet',
  reference: 'pvb-save-operation',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};

export const response = {
  status: true,
  data: {
    status: 'successful',
    id: 'provider-transaction',
    internal_reference: 'provider-transaction',
    reference: 'provider-reference',
    third_party_reference: reservation.reference,
    amount: 10000,
    fee: 0,
    customer_id: 'source-customer',
    source_wallet: 'source-wallet',
    destination_wallet: 'savings-wallet',
  },
};

export function verifyPrimaryWalletSavingsProof(
  storedReservation: unknown,
  providerResponse: unknown,
  identityEvidence?: unknown,
  environment: 'staging' | 'production' = 'production'
) {
  return verifySavingsProof(
    storedReservation,
    providerResponse,
    identityEvidence,
    environment
  );
}
