import { describe, expect, it } from 'vitest';
import { verifyPrimaryWalletSavingsProof } from './primary-wallet-savings-proof';

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

  it('settles on the transaction-verify TSQ success bound to the reservation', () => {
    // The verify endpoint never returns the rich envelope: without TSQ
    // acceptance every reconciled contribution would hold pending
    // forever. The unguessable reference plus the amount, over the
    // authenticated provider channel, is the success signal.
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

  it('releases the hold on a TSQ failure bound to the reservation', () => {
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
