import { describe, expect, it } from 'vitest';
import { verifyPrimaryWalletSavingsProof as verifySavingsProof } from './primary-wallet-savings-proof';

const reservation = {
  operationId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  amountKobo: 10000,
  sourceWalletId: 'source-wallet',
  destinationWalletId: 'savings-wallet',
  reference: 'pvb-save-operation',
  businessId: 'business',
  providerCustomerId: 'source-customer',
};
const response = {
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

function verifyPrimaryWalletSavingsProof(
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

describe('primary wallet savings settlement proof', () => {
  it('accepts an exact provider transaction without using provider reference as our reference', () => {
    expect(verifyPrimaryWalletSavingsProof(reservation, response)).toEqual({
      status: 'verified',
      providerTransactionId: 'provider-transaction',
      operationId: reservation.operationId,
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'savings-wallet',
      businessId: 'business',
    });
  });

  it.each([
    { amount: 9999 },
    { source_wallet: 'another-wallet' },
    { destination_wallet: 'another-goal' },
    { third_party_reference: 'another-operation' },
    { customer_id: 'another-customer' },
    { customer_id: 'business' },
    { fee: 1 },
    { currency: 'USD' },
    { business_id: 'another-business' },
    { internal_reference: 'another-transaction' },
  ])('does not credit mismatched provider evidence: %j', (change) => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        ...response,
        data: { ...response.data, ...change },
      })
    ).toEqual({ status: 'unverified' });
  });

  it('authenticates a failed transfer against the same bindings without verifying settlement', () => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        ...response,
        data: { ...response.data, status: 'failed' },
      })
    ).toEqual({
      status: 'failed',
      providerTransactionId: 'provider-transaction',
      operationId: reservation.operationId,
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'savings-wallet',
      businessId: 'business',
    });
  });

  it.each([
    { amount: 9999 },
    { source_wallet: 'another-wallet' },
    { third_party_reference: 'another-operation' },
    { customer_id: 'another-customer' },
    { fee: 1 },
  ])('does not release the hold on mismatched failed evidence: %j', (change) => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        ...response,
        data: { ...response.data, status: 'failed', ...change },
      })
    ).toEqual({ status: 'unverified' });
  });

  it('does not treat a processing acceptance as wallet settlement', () => {
    for (const evidence of [
      { accepted: true },
      { status: true, data: { ...response.data, status: 'pending' } },
      { status: true, data: { status: 'failed' } },
      { status: false, data: { ...response.data, status: 'failed' } },
      {
        status: true,
        data: {
          status: 'pending',
          reference: reservation.reference,
          amount: 10000,
        },
      },
    ])
      expect(verifyPrimaryWalletSavingsProof(reservation, evidence)).toEqual({
        status: 'unverified',
      });
  });

  it('preserves the production TSQ success fallback', () => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        status: true,
        data: {
          status: 'success',
          reference: reservation.reference,
          amount: 10000,
        },
      })
    ).toEqual({
      status: 'verified',
      providerTransactionId: reservation.reference,
      operationId: reservation.operationId,
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'savings-wallet',
      businessId: 'business',
    });
  });

  it('preserves the production TSQ failure fallback', () => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        status: true,
        data: {
          status: 'failed',
          reference: reservation.reference,
          amount: 10000,
        },
      })
    ).toEqual({
      status: 'failed',
      providerTransactionId: reservation.reference,
      operationId: reservation.operationId,
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'savings-wallet',
      businessId: 'business',
    });
  });

  it.each([
    'success',
    'failed',
  ])('keeps staging TSQ %s pending because its identity and amount unit are unproven', (status) => {
    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        {
          status: true,
          data: { status, reference: reservation.reference, amount: 10000 },
        },
        undefined,
        'staging'
      )
    ).toEqual({ status: 'unverified' });
  });

  it('accepts the staging single-read evidence only with staging environment', () => {
    const stagingResponse = {
      ...response,
      data: { ...response.data, customer_id: 'business' },
    };
    const stagingEvidence = {
      environment: 'staging',
      wallet: {
        id: 'source-wallet',
        business_id: 'business',
        api_customer_id: 'source-customer',
        currency: 'NGN',
        status: 'active',
        is_frozen: false,
      },
      transaction: {
        id: 'provider-transaction',
        customer_id: 'business',
        source_wallet: 'source-wallet',
        destination_wallet: 'savings-wallet',
        status: 'successful',
        amount: 10000,
        fee: 0,
        reference: 'provider-reference',
        third_party_reference: reservation.reference,
      },
    };

    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        stagingResponse,
        stagingEvidence,
        'staging'
      )
    ).toMatchObject({ status: 'verified' });
    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        stagingResponse,
        stagingEvidence,
        'production'
      )
    ).toEqual({ status: 'unverified' });
  });

  it('requires direct staging corroboration when customer_id is provider customer ID', () => {
    const stagingResponse = {
      ...response,
      data: { ...response.data, customer_id: reservation.providerCustomerId },
    };
    const stagingEvidence = {
      environment: 'staging',
      wallet: {
        id: reservation.sourceWalletId,
        business_id: reservation.businessId,
        api_customer_id: reservation.providerCustomerId,
        currency: 'NGN',
        status: 'active',
        is_frozen: false,
      },
      transaction: {
        id: 'provider-transaction',
        customer_id: reservation.providerCustomerId,
        source_wallet: reservation.sourceWalletId,
        destination_wallet: reservation.destinationWalletId,
        status: 'successful',
        amount: 10000,
        fee: 0,
        reference: 'provider-reference',
        third_party_reference: reservation.reference,
      },
    };

    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        stagingResponse,
        stagingEvidence,
        'staging'
      )
    ).toMatchObject({ status: 'verified' });
    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        stagingResponse,
        undefined,
        'staging'
      )
    ).toEqual({ status: 'unverified' });
  });

  it('keeps rich staging failed responses unverified without releasing holds', () => {
    const failedResponse = {
      ...response,
      data: { ...response.data, status: 'failed' },
    };
    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        failedResponse,
        undefined,
        'staging'
      )
    ).toEqual({ status: 'unverified' });
  });

  it.each([
    { reference: 'another-operation' },
    { amount: 9999 },
  ])('does not settle or release on mismatched TSQ evidence: %j', (change) => {
    for (const status of ['success', 'failed']) {
      expect(
        verifyPrimaryWalletSavingsProof(reservation, {
          status: true,
          data: {
            status,
            reference: reservation.reference,
            amount: 10000,
            ...change,
          },
        })
      ).toEqual({ status: 'unverified' });
    }
  });
});
