import { describe, expect, it } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from '@/lib/piggyvest/prefunded-card-provider.test-fixture';
import { prefundedCardProviderEvidenceSchemas as schemas } from './prefunded-card-provider-evidence';

const single = {
  status: true,
  data: {
    id: 'transaction',
    customer_id: 'sender',
    source_wallet: 'source',
    destination_wallet: 'destination',
    reference: 'reference',
    status: 'successful',
    amount: 100,
    fee: 0,
    category: 'wallet_transfer',
    third_party_reference: null,
    internal_reference: 'internal',
  },
};

const bank = {
  id: 'bank-data',
  transaction_id: 'bank-transaction',
  reference: 'bank-reference',
  customer_id: 'recipient',
  source_wallet_id: '',
  destination_wallet_id: 'destination',
  type: 'inflow',
  category: 'bank_transfer_inflow',
  status: 'success',
  amount: 100,
  fee: 0,
  currency: 'NGN',
  timestamp: '2026-09-26T12:00:00Z',
};

describe('prefunded evidence boundaries', () => {
  it('accepts an empty destination only for a bank-inflow summary with an identified credited wallet', () => {
    const summary = {
      ...single,
      data: { ...single.data, category: 'bank-inflow', destination_wallet: '' },
    };
    expect(schemas.single.safeParse(summary).success).toBe(true);
    for (const change of [
      { category: 'bank-outflow' },
      { category: 'wallet_transfer' },
      { source_wallet: '' },
    ]) {
      expect(
        schemas.single.safeParse({
          ...summary,
          data: { ...summary.data, ...change },
        }).success
      ).toBe(false);
    }
  });
  it('accepts an absent bank session without inventing one', () => {
    const parsed = schemas.bank.parse(bank);
    expect(parsed.session_id).toBeUndefined();
    expect(parsed.id).toBe('bank-data');
    expect(parsed.timestamp).toBe('2026-09-26T12:00:00Z');
  });

  it('accepts captured inter/COMPLETED without inventing its omitted source', () => {
    const { source_wallet_id: _source, ...captured } = bank;
    const parsed = schemas.bank.parse({
      ...captured,
      type: 'inter',
      status: 'COMPLETED',
    });
    expect(parsed.source_wallet_id).toBeUndefined();
    expect(parsed.session_id).toBeUndefined();
    expect(parsed.status).toBe('COMPLETED');
  });

  it.each([
    { type: 'inter', status: 'success' },
    { type: 'inflow', status: 'COMPLETED' },
    { type: 'inter', status: 'PENDING' },
    { type: 'inter', status: 'FAILED' },
    { type: 'inter', status: 'COMPLETED', source_wallet_id: 'internal-wallet' },
    { type: 'inflow', status: 'success', source_wallet_id: undefined },
  ])('rejects mixed status pairs and internal sources: %j', (overrides) => {
    expect(schemas.bank.safeParse({ ...bank, ...overrides }).success).toBe(
      false
    );
  });

  it.each([
    null,
    'observed-session',
  ])('preserves the observed nullable bank session %s', (session_id) => {
    expect(schemas.bank.parse({ ...bank, session_id }).session_id).toBe(
      session_id
    );
  });

  it.each([
    '',
    'bad session',
    'x'.repeat(513),
    123,
    false,
  ])('rejects malformed bank sessions rather than treating them as absent: %s', (session_id) => {
    const result = schemas.bank.safeParse({ ...bank, session_id });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].path).toEqual(['session_id']);
  });

  it('accepts the documented successful single-transaction response without undocumented business/currency fields', () => {
    expect(schemas.single.parse(single).data.customer_id).toBe('sender');
  });

  it.each([
    'pending',
    'failed',
    'partial',
  ])('preserves the non-final single-transaction status %s', (status) => {
    expect(
      schemas.single.parse({ ...single, data: { ...single.data, status } }).data
        .status
    ).toBe(status);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('refuses unsafe financial amount %s at the amount path', (amount) => {
    const result = schemas.single.safeParse({
      ...single,
      data: { ...single.data, amount },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'data.amount'
        )
      ).toBe(true);
  });

  it('does not silently manufacture customer or source fields', () => {
    const { customer_id: _customer, ...withoutCustomer } = single.data;
    const { source_wallet: _source, ...withoutSource } = single.data;
    expect(
      schemas.single.safeParse({ ...single, data: withoutCustomer }).success
    ).toBe(false);
    expect(
      schemas.single.safeParse({ ...single, data: withoutSource }).success
    ).toBe(false);
  });

  it('retains the captured inflow taxonomy for durable normalization', () => {
    expect(
      schemas.envelope.parse({
        eventId: 'event',
        customer_id: 'customer',
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'inflow_transaction',
        eventData: {},
      }).eventCategory
    ).toBe('inflow_transaction');
  });

  it('bounds customer-filtered wallets and references', () => {
    expect(
      schemas.wallets.safeParse({
        status: true,
        data: {
          paginatedPayload: {
            edges: Array.from({ length: 101 }, () => ({
              id: 'wallet',
              business_id: 'business',
              currency: 'NGN',
            })),
          },
        },
      }).success
    ).toBe(false);
    expect(schemas.identifier.safeParse('reference\nvalue').success).toBe(
      false
    );
  });

  it('requires a destination customer in successful verifier results', () => {
    const result = schemas.verificationRows.safeParse([
      {
        result: {
          outcome: 'verified_success',
          request: fixture.claim,
          evidence: {
            reference: 'reference',
            providerTransactionId: 'transaction',
            businessId: 'business',
            sourceWalletId: 'source',
            destinationWalletId: 'destination',
            amountKobo: 100,
            currency: 'NGN',
          },
        },
      },
    ]);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0].path).toEqual([
        0,
        'result',
        'evidence',
        'destinationCustomerId',
      ]);
  });
});
