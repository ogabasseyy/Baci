import { describe, expect, it } from 'vitest';
import { liveTransactionStatus } from '@/lib/piggyvest/transaction-status-live.test-support';
import { piggyvestTransactionStatusSchemas as schemas } from './piggyvest-transaction-status';

const binding = {
  reference: 'pvb-save-00000000-0000-4000-8000-000000000002',
  amountKobo: 10000,
  sourceWalletId: '01JBSYNTHETICSOURCEWALLET1',
  destinationWalletId: '01JBSYNTHETICGOALWALLET001',
  customerId: '01JBSYNTHETICCUSTOMER00001',
};
const live = liveTransactionStatus(binding, 'successful');

describe('PiggyVest transaction status (TSQ) schema', () => {
  it.each([
    'pending',
    'successful',
    'failed',
  ] as const)('accepts the live wallet-transfer record (%s) without a currency field', (status) => {
    const parsed = schemas.response.parse(
      liveTransactionStatus(binding, status)
    );
    expect(parsed.data).toMatchObject({
      status,
      amount: binding.amountKobo,
      fee: 0,
      third_party_reference: binding.reference,
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
    });
    expect('currency' in parsed.data).toBe(false);
  });

  it('strips balances, names and other extras it does not need', () => {
    const parsed = schemas.walletTransfer.parse(live.data);
    for (const key of [
      'available_balance',
      'source_wallet_balance',
      'destination_wallet_balance',
      'meta',
      'narration',
    ])
      expect(key in parsed).toBe(false);
  });

  it('accepts an NGN currency when the provider adds one', () => {
    expect(
      schemas.walletTransfer.safeParse({ ...live.data, currency: 'NGN' })
        .success
    ).toBe(true);
  });

  it.each([
    ['a non-NGN currency', { currency: 'USD' }],
    ['a missing amount', { amount: undefined }],
    ['a fractional amount', { amount: 100.5 }],
    ['a zero amount', { amount: 0 }],
    ['a negative fee', { fee: -1 }],
    ['an unknown status', { status: 'reversed' }],
    ['a missing status', { status: undefined }],
    ['a missing reference', { reference: undefined }],
    ['a missing third-party reference', { third_party_reference: undefined }],
    ['a missing source wallet', { source_wallet: undefined }],
    ['a missing destination wallet', { destination_wallet: undefined }],
    ['an empty destination wallet', { destination_wallet: '' }],
    [
      'the same source and destination wallet',
      { destination_wallet: binding.sourceWalletId },
    ],
  ])('rejects %s', (_label, change) => {
    expect(
      schemas.walletTransfer.safeParse({ ...live.data, ...change }).success
    ).toBe(false);
  });

  it('keeps accepting the documented bank-transfer TSQ shape', () => {
    expect(
      schemas.data.safeParse({
        reference: 'PVB1234567890',
        status: 'success',
        amount: 10000,
        recipient: '0123456789',
        bank: 'GTBank',
        created_at: '2024-03-25T12:00:00Z',
      }).success
    ).toBe(true);
  });

  it('rejects an envelope that does not report success', () => {
    expect(schemas.response.safeParse({ ...live, status: false }).success).toBe(
      false
    );
  });
});
