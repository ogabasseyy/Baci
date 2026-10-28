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
    customer_id: 'business',
    source_wallet: 'source-wallet',
    destination_wallet: 'savings-wallet',
  },
};

export function identityEvidence(
  status: 'successful' | 'failed' = 'successful'
) {
  return {
    environment: 'production',
    wallet: {
      id: reservation.sourceWalletId,
      business_id: reservation.businessId,
      api_customer_id: reservation.providerCustomerId,
      currency: 'NGN',
      status: 'active',
      is_frozen: false,
    },
    transaction: {
      id: response.data.id,
      customer_id: 'business',
      source_wallet: reservation.sourceWalletId,
      destination_wallet: reservation.destinationWalletId,
      status,
      amount: reservation.amountKobo,
      fee: 0,
      reference: response.data.reference,
      third_party_reference: reservation.reference,
      internal_reference: response.data.id,
      category: 'p2p',
    },
  };
}

export function verifyPrimaryWalletSavingsProof(
  storedReservation: unknown,
  providerResponse: unknown,
  proofIdentity: unknown = identityEvidence(),
  environment: 'staging' | 'production' = 'production'
) {
  return verifySavingsProof(
    storedReservation,
    providerResponse,
    proofIdentity,
    environment
  );
}
