import { describe, expect, it } from 'vitest';
import {
  docsMinimalTransactionStatus,
  docsSingleTransaction,
  docsWalletTransferEnvelope,
} from '@/lib/piggyvest/provider-transfer-docs.test-support';
import { liveTransactionStatus } from '@/lib/piggyvest/transaction-status-live.test-support';
import { piggyvestTransactionStatusSchemas as schemas } from './piggyvest-transaction-status';

const binding = {
  reference: 'pvb-wt-00000000-0000-4000-8000-0000000000a1-1',
  amountKobo: 25000,
  sourceWalletId: '01JBSYNTHETICMAINWALLET001',
  destinationWalletId: '01JBSYNTHETICCOLLECTION001',
  customerId: '01JBSYNTHETICCUSTOMER00001',
};
const live = liveTransactionStatus(binding, 'successful');

describe('provider transfer record (the reader schema)', () => {
  it.each([
    'pending',
    'successful',
    'failed',
  ] as const)('accepts the live %s record', (status) => {
    expect(
      schemas.providerTransferResponse.safeParse(
        liveTransactionStatus(binding, status)
      ).success
    ).toBe(true);
  });

  it('accepts the docs single-transaction record', () => {
    expect(
      schemas.providerTransferResponse.safeParse(docsSingleTransaction(binding))
        .success
    ).toBe(true);
  });

  it.each([0, 1500, null])('accepts fee %j', (fee) => {
    expect(schemas.providerTransfer.parse({ ...live.data, fee }).fee).toBe(fee);
  });

  it('keeps currency and category so the reader can judge them', () => {
    const parsed = schemas.providerTransfer.parse({
      ...live.data,
      currency: 'USD',
      category: 'bank-inflow',
    });
    expect(parsed).toMatchObject({ currency: 'USD', category: 'bank-inflow' });
  });

  it.each([
    ['a missing fee', { fee: undefined }],
    ['a negative fee', { fee: -1 }],
    ['a fractional fee', { fee: 1.5 }],
    ['a partial status', { status: 'partial' }],
    ['a zero amount', { amount: 0 }],
    ['a null third-party reference', { third_party_reference: null }],
    ['an empty destination wallet', { destination_wallet: '' }],
    [
      'the same source and destination wallet',
      { destination_wallet: binding.sourceWalletId },
    ],
  ])('rejects %s', (_label, change) => {
    expect(
      schemas.providerTransfer.safeParse({ ...live.data, ...change }).success
    ).toBe(false);
  });

  it('rejects a body that does not report success or names no wallets', () => {
    expect(
      schemas.providerTransferResponse.safeParse({ ...live, status: false })
        .success
    ).toBe(false);
    expect(
      schemas.providerTransferResponse.safeParse(
        docsMinimalTransactionStatus(binding)
      ).success
    ).toBe(false);
  });

  it('leaves the shared wallet-transfer schema used by current callers as it was', () => {
    expect(
      schemas.walletTransfer.safeParse({ ...live.data, fee: null }).success
    ).toBe(false);
    expect(
      schemas.walletTransfer.safeParse({ ...live.data, fee: 1500 }).success
    ).toBe(true);
  });
});

describe('wallet-transfer webhook envelope', () => {
  const envelope = docsWalletTransferEnvelope(binding);

  it('parses the docs envelope and keeps our envelope reference', () => {
    expect(
      schemas.walletTransferEnvelope.parse(envelope).pvb_third_party_reference
    ).toBe(binding.reference);
  });

  it.each([0, 1500, null, undefined])('accepts an outflow fee of %j', (fee) => {
    expect(
      schemas.walletTransferEnvelope.safeParse({
        ...envelope,
        eventData: { ...envelope.eventData, fee },
      }).success
    ).toBe(true);
  });

  it('accepts an envelope whose details omit the category', () => {
    const { category: _category, ...eventData } = envelope.eventData;
    expect(
      schemas.walletTransferEnvelope.safeParse({ ...envelope, eventData })
        .success
    ).toBe(true);
  });

  it.each([
    ['another event type', { eventType: 'bank-transfer.outflow.success' }],
    ['another event category', { eventCategory: 'bank_transfer_outflow' }],
    [
      'a non-p2p detail category',
      { eventData: { ...envelope.eventData, category: 'bank-inflow' } },
    ],
    ['a negative fee', { eventData: { ...envelope.eventData, fee: -1 } }],
    ['an empty envelope reference', { pvb_third_party_reference: '' }],
  ])('rejects %s', (_label, change) => {
    expect(
      schemas.walletTransferEnvelope.safeParse({ ...envelope, ...change })
        .success
    ).toBe(false);
  });
});

describe('provider transfer expectation', () => {
  const expected = {
    amountKobo: binding.amountKobo,
    source: { walletId: binding.sourceWalletId, currency: 'NGN', role: 'main' },
    destination: {
      walletId: binding.destinationWalletId,
      currency: 'NGN',
      role: 'collection',
    },
    feeWallet: { walletId: '01JBSYNTHETICFEEWALLET0001', currency: 'NGN' },
  };

  it('accepts registered wallets with their recorded currency', () => {
    expect(
      schemas.providerTransferExpectation.safeParse(expected).success
    ).toBe(true);
  });

  it.each([
    ['a zero amount', { amountKobo: 0 }],
    [
      'the same wallet on both sides',
      {
        destination: {
          ...expected.destination,
          walletId: binding.sourceWalletId,
        },
      },
    ],
    [
      'a fee wallet that is the source',
      { feeWallet: { walletId: binding.sourceWalletId, currency: 'NGN' } },
    ],
    [
      'a fee wallet that is the destination',
      { feeWallet: { walletId: binding.destinationWalletId, currency: 'NGN' } },
    ],
    [
      'a bank destination',
      { destination: { ...expected.destination, role: 'bank' } },
    ],
    [
      'a missing currency',
      { source: { walletId: binding.sourceWalletId, role: 'main' } },
    ],
    ['an unexpected key', { customerId: binding.customerId }],
  ])('rejects %s', (_label, change) => {
    expect(
      schemas.providerTransferExpectation.safeParse({ ...expected, ...change })
        .success
    ).toBe(false);
  });
});
