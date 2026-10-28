import { describe, expect, it } from 'vitest';
import { savingsIdentityFixture as fixture } from '@/lib/piggyvest/primary-wallet-savings-identity.test-fixture';
import { primaryWalletSavingsIdentitySchemas as schemas } from './primary-wallet-savings-identity';

describe('primary savings identity evidence schemas', () => {
  it('accepts production wallet-scoped single-transaction evidence', () => {
    expect(
      schemas.evidence.parse({
        environment: 'production',
        wallet: fixture.wallet,
        transaction: fixture.productionSingleTransaction,
      })
    ).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.productionSingleTransaction,
    });
    expect(
      schemas.evidence.safeParse({
        environment: 'production',
        wallet: fixture.wallet,
        transaction: fixture.transaction,
      }).success
    ).toBe(false);
  });

  it('accepts the observed single-read projection only with staging provenance', () => {
    expect(
      schemas.evidence.parse({
        environment: 'staging',
        wallet: fixture.wallet,
        transaction: fixture.singleTransaction,
      })
    ).toEqual({
      environment: 'staging',
      wallet: fixture.wallet,
      transaction: fixture.singleTransaction,
    });
    expect(
      schemas.evidence.safeParse({
        environment: 'production',
        wallet: fixture.wallet,
        transaction: fixture.singleTransaction,
      }).success
    ).toBe(false);
    expect(
      schemas.evidence.safeParse({
        environment: 'staging',
        wallet: fixture.wallet,
        transaction: fixture.transaction,
      }).success
    ).toBe(false);
  });

  it.each([
    { currency: 'USD' },
    { status: 'inactive' },
    { is_frozen: true },
    { id: '' },
    { business_id: 'has whitespace' },
    { api_customer_id: '\n' },
  ])('rejects unsupported or malformed wallet evidence: %j', (change) => {
    expect(
      schemas.wallet.safeParse({ ...fixture.wallet, ...change }).success
    ).toBe(false);
  });

  it.each([
    { currency: 'USD' },
    { type: 'credit' },
    { category: 'interest' },
    { status: 'pending' },
    { amount: 0 },
    { amount: 10000 },
    { amount: -1.5 },
    { amount: -Number.MAX_SAFE_INTEGER - 1 },
    { charge: 1 },
    { third_party_reference: '' },
    { provider_reference: '\u007f' },
  ])('rejects unproved or unsafe debit evidence: %j', (change) => {
    expect(
      schemas.transaction.safeParse({ ...fixture.transaction, ...change })
        .success
    ).toBe(false);
  });

  it('requires a next-page cursor whenever more results exist', () => {
    expect(
      schemas.page.safeParse({
        edges: [],
        pageInfo: { hasNextPage: true, endCursor: null },
      }).success
    ).toBe(false);
    expect(schemas.page.parse(fixture.page)).toEqual(fixture.page);
  });

  it('bounds page size and requires identifiers on every entry', () => {
    expect(
      schemas.page.safeParse({
        ...fixture.page,
        edges: Array.from({ length: 101 }, () => ({ id: 'entry' })),
      }).success
    ).toBe(false);
    expect(
      schemas.page.safeParse({ ...fixture.page, edges: [{}] }).success
    ).toBe(false);
  });

  it('rejects extra authority claims in the evidence envelope', () => {
    expect(
      schemas.evidence.safeParse({
        wallet: fixture.wallet,
        transaction: fixture.transaction,
        creditApproved: true,
      }).success
    ).toBe(false);
  });
});
