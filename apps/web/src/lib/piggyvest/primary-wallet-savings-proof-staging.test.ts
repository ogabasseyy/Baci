import { describe, expect, it } from 'vitest';
import {
  reservation,
  response,
  verifyPrimaryWalletSavingsProof,
} from './primary-wallet-savings-proof.test-fixture';

describe('staging primary wallet savings settlement proof', () => {
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
});
