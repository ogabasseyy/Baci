import { describe, expect, it } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

describe('primary savings early-page production corroboration', () => {
  it('corroborates an exact candidate before accepting a nonterminal page', async () => {
    const input = requestInput(
      [
        {
          ...fixture.page,
          pageInfo: { hasNextPage: true, endCursor: 'later-page' },
        },
      ],
      fixture.wallet,
      'production',
      {
        ...fixture.singleTransaction,
        // Require the same reported amount without applying a unit conversion.
        amount: fixture.providerResponse.data.amount,
      }
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
    expect(String(input.fetchImplementation.mock.calls[2][0])).toBe(
      'https://api.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet'
    );
  });

  it.each([
    { id: 'other-transfer' },
    { status: 'pending' },
    { customer_id: 'other-customer' },
    { source_wallet: 'other-wallet' },
    { destination_wallet: 'other-wallet' },
    { amount: fixture.singleTransaction.amount + 1 },
    { reference: 'other-provider-reference' },
    { third_party_reference: 'other-merchant-reference' },
    { fee: 1 },
    { internal_reference: 'other-transfer' },
  ])('fails closed when the single-read mismatches: %j', async (change) => {
    const input = requestInput(
      [
        {
          ...fixture.page,
          pageInfo: { hasNextPage: true, endCursor: 'later-page' },
        },
      ],
      fixture.wallet,
      'production',
      { ...fixture.singleTransaction, ...change }
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the early single-read is missing', async () => {
    const input = requestInput(
      [
        {
          ...fixture.page,
          pageInfo: { hasNextPage: true, endCursor: 'later-page' },
        },
      ],
      fixture.wallet,
      'production',
      null
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('rejects duplicate candidate IDs on the current page before single-read', async () => {
    const input = requestInput([
      {
        ...fixture.page,
        edges: [fixture.transaction, fixture.transaction],
        pageInfo: { hasNextPage: true, endCursor: 'later-page' },
      },
    ]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
