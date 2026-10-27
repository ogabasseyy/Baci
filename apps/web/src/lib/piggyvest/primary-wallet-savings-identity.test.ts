import { describe, expect, it } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';

// Sanitized user-provided read-only QA observation, 2026-10-27: three existing
// staging transfers each returned successful /verify amount +10000; their
// single-transaction reads returned successful amount +10000, fee 0, and
// matching IDs, source/destination wallets, provider reference, and merchant
// reference. Each first list page had exactly one matching successful debit
// amount -10000 kobo, fee 0, with the same merchant reference. These three
// staging samples do not establish production behavior or a general provider
// contract. No wallet/customer identifiers or raw response bodies are stored.
describe('primary savings transfer identity corroboration', () => {
  it('binds a business-scoped response to the customer wallet and its debit', async () => {
    const input = requestInput();

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
    expect(
      input.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toEqual([
      'https://api.piggyvest.business/api/v1/wallet/source-wallet',
      'https://api.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet',
      'https://api.piggyvest.business/api/v1/transaction?wallet_id=source-wallet&limit=100&collapse_batch=0',
    ]);
  });

  it('uses the exact single-transaction lookup only for staging', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging');

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'staging',
      wallet: fixture.wallet,
      transaction: fixture.singleTransaction,
    });
    expect(
      input.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toEqual([
      'https://staging.piggyvest.business/api/v1/wallet/source-wallet',
      'https://staging.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet',
    ]);
  });

  it('strips unneeded fields from a richer staging single-transaction response', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      business_id: 'business',
      wallet_id: 'source-wallet',
      currency: 'NGN',
      type: 'debit',
      category: 'p2p',
      charge: 0,
      provider_reference: 'provider-reference',
      unrelated_provider_metadata: { retainedByProvider: true },
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'staging',
      wallet: fixture.wallet,
      transaction: fixture.singleTransaction,
    });
  });

  it('corroborates staging when verify customer_id is the provider customer ID', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      customer_id: fixture.reservation.providerCustomerId,
    });
    input.providerResponse = {
      ...fixture.providerResponse,
      data: {
        ...fixture.providerResponse.data,
        customer_id: fixture.reservation.providerCustomerId,
      },
    };

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'staging',
      transaction: { customer_id: fixture.reservation.providerCustomerId },
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 'another-transaction' },
    { status: 'pending' },
    { customer_id: 'another-business' },
    { source_wallet: 'another-source' },
    { destination_wallet: 'another-destination' },
    { amount: 9999 },
    { fee: 1 },
    { reference: 'another-provider-reference' },
    { third_party_reference: null },
    { third_party_reference: 'another-merchant-reference' },
    { internal_reference: 'another-transaction' },
  ])('fails closed on a staging single-transaction mismatch: %j', async (change) => {
    const input = requestInput([fixture.page], fixture.wallet, 'staging', {
      ...fixture.singleTransaction,
      ...change,
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each([
    { customer_id: fixture.reservation.providerCustomerId },
    { customer_id: 'other-business' },
    { business_id: 'other-business' },
    { destination_customer_id: 'other-customer' },
    { source_wallet: 'other-wallet' },
    { destination_wallet: 'other-wallet' },
    { amount: 9999 },
    { third_party_reference: 'other-reference' },
    { currency: 'USD' },
  ])('rejects conflicting transfer fields before requesting corroboration: %j', async (change) => {
    const input = requestInput();

    expect(
      await resolvePrimaryWalletSavingsIdentity({
        ...input,
        providerResponse: {
          ...fixture.providerResponse,
          data: { ...fixture.providerResponse.data, ...change },
        },
      })
    ).toBeNull();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'other-wallet' },
    { business_id: 'other-business' },
    { api_customer_id: 'other-customer' },
    { is_frozen: true },
    { currency: 'USD' },
  ])('rejects a source wallet with conflicting ownership or state: %j', async (change) => {
    const input = requestInput([fixture.page], {
      ...fixture.wallet,
      ...change,
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each([
    { business_id: 'other-business' },
    { wallet_id: 'other-wallet' },
    { api_customer_id: 'other-customer' },
    { amount: -9999 },
    { third_party_reference: 'other-reference' },
    { provider_reference: 'other-reference' },
    { charge: 1 },
    { currency: 'USD' },
  ])('rejects conflicting authenticated debit evidence: %j', async (change) => {
    const input = requestInput([
      { ...fixture.page, edges: [{ ...fixture.transaction, ...change }] },
    ]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
  });

  it('finds the exact transaction on a later page', async () => {
    const input = requestInput([
      {
        edges: [{ id: 'unrelated' }],
        pageInfo: { hasNextPage: true, endCursor: 'next-page' },
      },
      fixture.page,
    ]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(String(input.fetchImplementation.mock.calls[3][0])).toContain(
      'cursor=next-page'
    );
  });

  it('rejects duplicate transaction identifiers across pages', async () => {
    const input = requestInput([
      {
        edges: [{ id: 'duplicate' }],
        pageInfo: { hasNextPage: true, endCursor: 'next-page' },
      },
      {
        edges: [{ id: 'duplicate' }, fixture.transaction],
        pageInfo: { hasNextPage: true, endCursor: 'final-page' },
      },
    ]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
  });

  it('rejects a repeated cursor instead of accepting an incomplete scan', async () => {
    const input = requestInput([
      {
        edges: [{ id: 'first' }],
        pageInfo: { hasNextPage: true, endCursor: 'repeated' },
      },
      {
        edges: [{ id: 'second' }],
        pageInfo: { hasNextPage: true, endCursor: 'repeated' },
      },
    ]);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it('requires a complete list and stops after the bounded page limit', async () => {
    const input = requestInput(
      Array.from({ length: limits.maxPages }, (_, page) => ({
        edges: [{ id: `other-${page}` }],
        pageInfo: { hasNextPage: true, endCursor: `cursor-${page}` },
      }))
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(
      limits.maxPages + 2
    );
  });

  it('does not infer success from an absent transaction or an unavailable provider', async () => {
    expect(
      await resolvePrimaryWalletSavingsIdentity(
        requestInput([
          { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
        ])
      )
    ).toBeNull();
    const input = requestInput();
    input.fetchImplementation
      .mockReset()
      .mockRejectedValue(new Error('unavailable'));
    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
  });

  it('rejects malformed reservations, unknown environments and empty credentials without network access', async () => {
    const input = requestInput();
    for (const change of [
      { reservation: {} },
      { environment: 'unknown' },
      { token: ' ' },
    ]) {
      expect(
        await resolvePrimaryWalletSavingsIdentity({ ...input, ...change })
      ).toBeNull();
    }
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});
