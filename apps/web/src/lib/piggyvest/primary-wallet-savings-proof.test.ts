import { describe, expect, it } from 'vitest';
import { verifyPrimaryWalletSavingsProof } from './primary-wallet-savings-proof';
import { liveTransactionStatus } from './transaction-status-live.test-support';

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

  // "Success by reference" alone must never move or release money: a body
  // that matches only our reference, the amount and a status proves neither
  // direction, fee nor either wallet.
  it.each([
    ['minimal success', { status: 'success' }],
    ['minimal successful', { status: 'successful' }],
    ['minimal failed', { status: 'failed' }],
    [
      'documented bank success',
      { status: 'success', recipient: '0123456789', bank: 'Sandbox Bank' },
    ],
    [
      'documented bank failed',
      { status: 'failed', recipient: '0123456789', bank: 'Sandbox Bank' },
    ],
  ])('never settles or releases on a reference-only %s body', (_label, data) => {
    expect(
      verifyPrimaryWalletSavingsProof(reservation, {
        status: true,
        data: {
          reference: reservation.reference,
          third_party_reference: reservation.reference,
          amount: 10000,
          created_at: '2026-10-31T10:00:00Z',
          ...data,
        },
      })
    ).toEqual({ status: 'unverified' });
  });

  describe('against the live TSQ record (docs/piggyvest-contract-evidence/2026-10-31.md, P2)', () => {
    const binding = {
      reference: reservation.reference,
      amountKobo: reservation.amountKobo,
      sourceWalletId: reservation.sourceWalletId,
      destinationWalletId: reservation.destinationWalletId,
      customerId: reservation.providerCustomerId,
    };
    const bound = {
      operationId: reservation.operationId,
      reference: reservation.reference,
      amountKobo: 10000,
      sourceWalletId: 'source-wallet',
      destinationWalletId: 'savings-wallet',
      businessId: 'business',
    };

    it('settles a successful record from the main wallet to the goal wallet', () => {
      const live = liveTransactionStatus(binding, 'successful');
      expect(verifyPrimaryWalletSavingsProof(reservation, live)).toEqual({
        status: 'verified',
        providerTransactionId: live.data.id,
        ...bound,
      });
    });

    it('releases only on a terminal failure of that exact record', () => {
      const live = liveTransactionStatus(binding, 'failed');
      expect(verifyPrimaryWalletSavingsProof(reservation, live)).toEqual({
        status: 'failed',
        providerTransactionId: live.data.id,
        ...bound,
      });
    });

    it('neither settles nor releases a pending record', () => {
      expect(
        verifyPrimaryWalletSavingsProof(
          reservation,
          liveTransactionStatus(binding, 'pending')
        )
      ).toEqual({ status: 'unverified' });
    });

    it.each([
      ['another source wallet', { source_wallet: 'another-wallet' }],
      ['another destination wallet', { destination_wallet: 'another-goal' }],
      [
        'the reverse direction',
        {
          source_wallet: 'savings-wallet',
          destination_wallet: 'source-wallet',
        },
      ],
      ['a non-zero fee', { fee: 1 }],
      ['a non-NGN currency', { currency: 'USD' }],
      ['another source customer', { customer_id: 'another-customer' }],
    ])('neither settles nor releases a matching reference, amount and status with %s', (_label, change) => {
      for (const status of ['successful', 'failed'] as const) {
        const live = liveTransactionStatus(binding, status);
        expect(
          verifyPrimaryWalletSavingsProof(reservation, {
            ...live,
            data: { ...live.data, ...change },
          })
        ).toEqual({ status: 'unverified' });
      }
    });
  });
});
