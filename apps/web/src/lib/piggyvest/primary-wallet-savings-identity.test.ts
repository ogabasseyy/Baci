import { describe, expect, it, vi } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';

function requestInput(
  pages: unknown[] = [fixture.page],
  wallet: unknown = fixture.wallet
) {
  const fetchImplementation = vi.fn<typeof fetch>();
  for (const data of [wallet, ...pages]) {
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: true, data }))
    );
  }
  return {
    reservation: fixture.reservation,
    providerResponse: fixture.providerResponse,
    environment: 'staging',
    token: 'unit-test-token',
    fetchImplementation,
  };
}

describe('primary savings transfer identity corroboration', () => {
  it('binds a business-scoped response to the customer wallet and its debit', async () => {
    const input = requestInput();

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      input.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toEqual([
      'https://staging.piggyvest.business/api/v1/wallet/source-wallet',
      'https://staging.piggyvest.business/api/v1/transaction?wallet_id=source-wallet&limit=100&collapse_batch=0',
    ]);
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
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(String(input.fetchImplementation.mock.calls[2][0])).toContain(
      'cursor=next-page'
    );
  });

  it('rejects duplicate transaction identifiers across pages', async () => {
    const input = requestInput([
      {
        edges: [fixture.transaction],
        pageInfo: { hasNextPage: true, endCursor: 'next-page' },
      },
      fixture.page,
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
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('requires a complete list and stops after five pages', async () => {
    const input = requestInput(
      Array.from({ length: 5 }, (_, page) => ({
        edges: [{ id: `other-${page}` }],
        pageInfo: { hasNextPage: true, endCursor: `cursor-${page}` },
      }))
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(6);
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
