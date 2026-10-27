import { describe, expect, it, vi } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';

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
    expect(String(input.fetchImplementation.mock.calls[1][0])).toBe(
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
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a received direct read is malformed', async () => {
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
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a malformed direct response body without list fallback', async () => {
    const input = requestInput([fixture.page]);
    const defaultFetch = input.fetchImplementation.getMockImplementation();
    input.fetchImplementation.mockImplementation((url, init) =>
      /\/api\/v1\/transaction\/[^/]+\?/.test(String(url))
        ? Promise.resolve(new Response('{'))
        : (defaultFetch?.(url, init) ?? Promise.resolve(new Response()))
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('falls back to the bounded complete scan when the direct request is unavailable', async () => {
    const input = requestInput([fixture.page]);
    const defaultFetch = input.fetchImplementation.getMockImplementation();
    input.fetchImplementation.mockImplementation((url, init) => {
      if (/\/api\/v1\/transaction\/[^/]+\?/.test(String(url)))
        return Promise.reject(new Error('network unavailable'));
      return defaultFetch?.(url, init) ?? Promise.resolve(new Response());
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.transaction,
    });
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
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('finds and corroborates the exact candidate on page six when more pages remain', async () => {
    const pages = [
      ...Array.from({ length: 5 }, (_, index) => ({
        edges: [{ id: `unrelated-${index}` }],
        pageInfo: { hasNextPage: true, endCursor: `cursor-${index + 1}` },
      })),
      {
        ...fixture.page,
        pageInfo: { hasNextPage: true, endCursor: 'cursor-six' },
      },
    ];
    const input = requestInput(pages);

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(8);
    expect(String(input.fetchImplementation.mock.calls[7][0])).toContain(
      'cursor=cursor-5'
    );
    expect(String(input.fetchImplementation.mock.calls[1][0])).toBe(
      'https://api.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet'
    );
  });

  it('uses the validated direct timestamp to locate a deep-history list row first', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'production', {
      ...fixture.singleTransaction,
      created_at: '2024-06-15T12:00:00.000Z',
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toEqual({
      environment: 'production',
      wallet: fixture.wallet,
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
    const listUrl = new URL(String(input.fetchImplementation.mock.calls[2][0]));
    expect(listUrl.searchParams.get('start_date')).toBe(
      '2024-06-14T12:00:00.000Z'
    );
    expect(listUrl.searchParams.get('end_date')).toBe(
      '2024-06-16T12:00:00.000Z'
    );
  });

  it.each([
    undefined,
    'not-a-timestamp',
  ])('uses the original wallet scan when direct created_at is unsupported: %j', async (createdAt) => {
    const input = requestInput([fixture.page], fixture.wallet, 'production', {
      ...fixture.singleTransaction,
      created_at: createdAt,
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
    expect(
      new URL(
        String(input.fetchImplementation.mock.calls[2][0])
      ).searchParams.has('start_date')
    ).toBe(false);
  });

  it('falls back to the original wallet scan when the date filter is unsupported', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'production', {
      ...fixture.singleTransaction,
      created_at: '2024-06-15T12:00:00.000Z',
    });
    const fetchImplementation =
      input.fetchImplementation.getMockImplementation();
    input.fetchImplementation.mockImplementation((url, init) => {
      if (new URL(String(url)).searchParams.has('start_date'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: 'Unsupported query parameter: start_date',
            }),
            { status: 400 }
          )
        );
      return (
        fetchImplementation?.(url, init) ?? Promise.resolve(new Response())
      );
    });

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
    expect(
      new URL(
        String(input.fetchImplementation.mock.calls[3][0])
      ).searchParams.has('start_date')
    ).toBe(false);
  });

  it('still requires the exact list debit in kobo after direct locator validation', async () => {
    const input = requestInput(
      [
        {
          ...fixture.page,
          edges: [{ ...fixture.transaction, amount: -9999 }],
        },
      ],
      fixture.wallet,
      'production',
      {
        ...fixture.singleTransaction,
        created_at: '2024-06-15T12:00:00.000Z',
      }
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it('tries the direct locator before a slow first page and never settles on timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const input = requestInput();
      const envelope = (data: unknown) =>
        new Response(JSON.stringify({ status: true, data }));
      let filteredSignal: AbortSignal | undefined;
      let fallbackSignal: AbortSignal | undefined;
      input.fetchImplementation
        .mockReset()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(() => resolve(envelope(fixture.wallet)), 6_000);
            })
        )
        .mockResolvedValueOnce(
          envelope({
            ...fixture.singleTransaction,
            created_at: '2024-06-15T12:00:00.000Z',
          })
        )
        .mockImplementationOnce((_url, init) => {
          filteredSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        })
        .mockImplementationOnce((_url, init) => {
          fallbackSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        });

      const result = resolvePrimaryWalletSavingsIdentity(input);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
      expect(
        new URL(
          String(input.fetchImplementation.mock.calls[2][0])
        ).searchParams.has('start_date')
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(limits.timeBudgetMs - 6_001);
      expect(filteredSignal?.aborted).toBe(true);
      expect(fallbackSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBeNull();
      expect(fallbackSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
