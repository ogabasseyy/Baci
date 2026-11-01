import { describe, expect, it } from 'vitest';
import {
  docsMinimalTransactionStatus,
  docsSingleTransaction,
} from './provider-transfer-docs.test-support';
import { readProviderTransferResponse } from './provider-transfer-reader';
import {
  readerCollection as collection,
  readerExpected as expected,
  readerFeeWallet as feeWallet,
  readerLiveRecord as live,
  readerMain as main,
  readerCustomerId,
  readerReference as reference,
} from './provider-transfer-reader.test-support';
import { classifyTransferReferenceResponse } from './transfer-reference-lookup';

const binding = {
  reference,
  amountKobo: expected.amountKobo,
  sourceWalletId: main.walletId,
  destinationWalletId: collection.walletId,
};

function read(response: unknown, change: Record<string, unknown> = {}) {
  return readProviderTransferResponse(response, {
    reference,
    expected: { ...expected, ...change },
  });
}

describe('provider transfer reader: bound records', () => {
  it('reads a bound live success as submitted with its full binding', () => {
    expect(read(live('successful'))).toEqual({
      outcome: 'submitted',
      transfer: {
        reference,
        providerTransactionId: 'TRX01JBSYNTHETIC00000000001',
        providerReference: '01JBSYNTHETICPROVIDERREF01',
        providerStatus: 'successful',
        amountKobo: expected.amountKobo,
        currency: 'NGN',
        currencyBoundBy: 'registered_wallets',
        fee: { kobo: 0, payer: 'none', payerWalletId: null },
        direction: { from: 'main', to: 'collection' },
        sourceWalletId: main.walletId,
        destinationWalletId: collection.walletId,
        providerCustomerId: readerCustomerId,
      },
    });
  });

  it.each([
    ['pending', 'pending'],
    ['failed', 'failed'],
    ['success', 'submitted'],
  ] as const)('reads a bound %s record as %s, like the shared lookup', (status, outcome) => {
    const body = live('successful', { status });
    expect(read(body).outcome).toBe(outcome);
    expect(classifyTransferReferenceResponse(body, binding)).toBe(outcome);
  });

  it('parses the docs single-transaction fixture and binds it', () => {
    const single = docsSingleTransaction(binding);
    expect(read(single)).toMatchObject({
      outcome: 'submitted',
      transfer: { providerTransactionId: single.data.id, reference },
    });
  });

  it('takes the direction from the registered wallets', () => {
    const refund = live('successful', {
      source_wallet: collection.walletId,
      destination_wallet: main.walletId,
    });
    expect(
      read(refund, { source: collection, destination: main })
    ).toMatchObject({
      outcome: 'submitted',
      transfer: { direction: { from: 'collection', to: 'main' } },
    });
  });
});

describe('provider transfer reader: fee and payer', () => {
  it('reads fee=1500 as submitted with the source wallet as payer', () => {
    expect(read(live('successful', { fee: 1500 }))).toMatchObject({
      outcome: 'submitted',
      transfer: {
        fee: { kobo: 1500, payer: 'source', payerWalletId: main.walletId },
      },
    });
  });

  it('names the registered Fee wallet as payer when fees are routed to it', () => {
    expect(
      read(live('successful', { fee: 1500 }), { feeWallet })
    ).toMatchObject({
      outcome: 'submitted',
      transfer: {
        fee: {
          kobo: 1500,
          payer: 'fee_wallet',
          payerWalletId: feeWallet.walletId,
        },
      },
    });
  });

  it.each([
    ['without', {}],
    ['with', { feeWallet }],
  ])('reads a null fee as unknown, %s a Fee wallet', (_label, change) => {
    expect(read(live('successful', { fee: null }), change)).toMatchObject({
      outcome: 'submitted',
      transfer: { fee: { kobo: null, payer: 'unknown', payerWalletId: null } },
    });
  });

  it('reads a zero fee as paid by nobody even with a Fee wallet', () => {
    expect(read(live('successful'), { feeWallet })).toMatchObject({
      transfer: { fee: { kobo: 0, payer: 'none', payerWalletId: null } },
    });
  });
});

describe('provider transfer reader: currency', () => {
  it('binds NGN from a record that names it', () => {
    expect(read(live('successful', { currency: 'NGN' }))).toMatchObject({
      outcome: 'submitted',
      transfer: { currency: 'NGN', currencyBoundBy: 'record' },
    });
  });

  it.each([
    'USD',
    'ngn',
    'GHS',
  ])('keeps a record in currency %s uncertain, whatever its status', (currency) => {
    for (const status of ['successful', 'pending', 'failed'] as const)
      expect(read(live(status, { currency }))).toEqual({
        outcome: 'uncertain',
        reason: 'currency_mismatch',
      });
  });

  it.each([
    ['source', { source: { ...main, currency: 'USD' } }],
    ['destination', { destination: { ...collection, currency: 'ngn' } }],
    ['fee', { feeWallet: { ...feeWallet, currency: 'USD' } }],
  ])('binds a currency-less record only when every registered wallet is NGN (%s)', (_label, change) => {
    expect(read(live('successful'), change)).toEqual({
      outcome: 'uncertain',
      reason: 'currency_unbound',
    });
    expect(read(live('successful', { currency: 'NGN' }), change)).toEqual({
      outcome: 'uncertain',
      reason: 'currency_unbound',
    });
  });
});

describe('provider transfer reader: unbound records stay uncertain', () => {
  it.each([
    ['reference_mismatch', { third_party_reference: 'pvb-wt-other' }],
    ['amount_mismatch', { amount: expected.amountKobo + 1 }],
    ['amount_mismatch', { amount: expected.amountKobo - 1 }],
    [
      'direction_reversed',
      { source_wallet: collection.walletId, destination_wallet: main.walletId },
    ],
    ['wallet_mismatch', { source_wallet: '01JBSYNTHETICOTHERWALLET01' }],
    ['wallet_mismatch', { destination_wallet: '01JBSYNTHETICOTHERWALLET01' }],
    ['category_mismatch', { category: 'bank-inflow' }],
    ['category_mismatch', { category: 'P2P' }],
  ])('%s: %j', (reason, change) => {
    for (const status of ['successful', 'pending', 'failed'] as const)
      expect(read(live(status, change))).toEqual({
        outcome: 'uncertain',
        reason,
      });
  });

  it('accepts a record without a category', () => {
    const { category: _category, ...data } = live('successful').data;
    expect(read({ status: true, data }).outcome).toBe('submitted');
  });

  it('binds the business only when both sides name one', () => {
    const named = live('successful', {
      business_id: '01JBSYNTHETICBUSINESS0001',
    });
    expect(read(named).outcome).toBe('submitted');
    expect(
      read(named, { businessId: '01JBSYNTHETICBUSINESS0001' }).outcome
    ).toBe('submitted');
    expect(
      read(live('successful'), { businessId: '01JBSYNTHETICBUSINESS0001' })
        .outcome
    ).toBe('submitted');
    expect(read(named, { businessId: '01JBSYNTHETICBUSINESS0002' })).toEqual({
      outcome: 'uncertain',
      reason: 'business_mismatch',
    });
  });

  it.each([
    ['the documented minimal TSQ', docsMinimalTransactionStatus(binding)],
    ['an unsuccessful envelope', { ...live('successful'), status: false }],
    ['a partial status', live('successful', { status: 'partial' })],
    ['a missing fee', live('successful', { fee: undefined })],
    ['null', null],
    ['text', 'Transaction status retrieved'],
    [
      'the normalized success envelope',
      {
        status: true,
        data: {
          status: 'success',
          id: 'provider-transaction',
          reference,
          amount: expected.amountKobo,
          currency: 'NGN',
          business_id: 'business',
          source_wallet: main.walletId,
          destination_wallet: collection.walletId,
          destination_customer_id: 'customer',
        },
      },
    ],
  ])('reads %s as uncertain', (_label, body) => {
    expect(read(body)).toEqual({
      outcome: 'uncertain',
      reason: 'record_unreadable',
    });
  });

  it.each([
    ['a zero amount', { amountKobo: 0 }],
    ['the same wallet on both sides', { destination: main }],
    [
      'the source as fee wallet',
      { feeWallet: { walletId: main.walletId, currency: main.currency } },
    ],
    [
      'the destination as fee wallet',
      {
        feeWallet: {
          walletId: collection.walletId,
          currency: collection.currency,
        },
      },
    ],
  ])('refuses %s before reading the record', (_label, change) => {
    expect(read(live('successful'), change)).toEqual({
      outcome: 'uncertain',
      reason: 'expectation_invalid',
    });
  });

  it('refuses an empty reference', () => {
    expect(
      readProviderTransferResponse(live('successful'), {
        reference: '',
        expected,
      })
    ).toEqual({ outcome: 'uncertain', reason: 'expectation_invalid' });
  });
});
