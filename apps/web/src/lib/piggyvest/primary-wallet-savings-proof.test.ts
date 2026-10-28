import { describe, expect, it } from 'vitest';
import {
  identityEvidence,
  reservation,
  response,
  verifyPrimaryWalletSavingsProof,
} from './primary-wallet-savings-proof.test-fixture';

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
      verifyPrimaryWalletSavingsProof(
        reservation,
        {
          ...response,
          data: { ...response.data, status: 'failed' },
        },
        identityEvidence('failed')
      )
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

  it.each([
    'success',
    'failed',
  ])('does not settle or release on production TSQ-only %s without transaction identity', (status) => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        status: true,
        data: {
          status,
          reference: reservation.reference,
          amount: 10000,
        },
      })
    ).toEqual({ status: 'unverified' });
  });

  it('retains exact rich production success proof', () => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, response)
    ).toMatchObject({
      status: 'verified',
      providerTransactionId: 'provider-transaction',
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: reservation.sourceWalletId,
      destinationWalletId: reservation.destinationWalletId,
    });
  });

  it.each([
    { transaction: { category: 'bank-outflow' } },
    { transaction: { source_wallet: 'another-wallet' } },
    { wallet: { id: 'another-wallet' } },
    { wallet: { business_id: 'another-business' } },
    { wallet: { api_customer_id: 'another-customer' } },
  ])('requires direct production identity and wallet scope: %j', (change) => {
    const identityEvidence = {
      environment: 'production',
      wallet: {
        id: reservation.sourceWalletId,
        business_id: reservation.businessId,
        api_customer_id: reservation.providerCustomerId,
        currency: 'NGN',
        status: 'active',
        is_frozen: false,
        ...change.wallet,
      },
      transaction: {
        id: response.data.id,
        customer_id: 'business',
        source_wallet: reservation.sourceWalletId,
        destination_wallet: reservation.destinationWalletId,
        status: 'successful',
        amount: reservation.amountKobo,
        fee: 0,
        reference: response.data.reference,
        third_party_reference: reservation.reference,
        internal_reference: response.data.id,
        category: 'p2p',
        ...change.transaction,
      },
    };
    expect(
      verifyPrimaryWalletSavingsProof(reservation, response, identityEvidence)
    ).toEqual({ status: 'unverified' });
  });

  it('does not accept a production TSQ response without direct transaction evidence', () => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, response, null)
    ).toEqual({ status: 'unverified' });
  });

  it('retains exact rich production failure proof for hold release', () => {
    expect(
      verifyPrimaryWalletSavingsProof(
        reservation,
        {
          ...response,
          data: { ...response.data, status: 'failed' },
        },
        identityEvidence('failed')
      )
    ).toMatchObject({
      status: 'failed',
      providerTransactionId: 'provider-transaction',
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: reservation.sourceWalletId,
      destinationWalletId: reservation.destinationWalletId,
    });
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
