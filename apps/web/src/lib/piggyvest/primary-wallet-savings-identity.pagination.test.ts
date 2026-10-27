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
    expect(String(input.fetchImplementation.mock.calls[6][0])).toContain(
      'cursor=cursor-5'
    );
    expect(String(input.fetchImplementation.mock.calls[7][0])).toBe(
      'https://api.piggyvest.business/api/v1/transaction/transfer-id?wallet_id=source-wallet'
    );
  });

  it('shares the 20-second deadline across wallet, list and direct reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const input = requestInput([
        {
          ...fixture.page,
          pageInfo: { hasNextPage: true, endCursor: 'later-page' },
        },
      ]);
      const envelope = (data: unknown) =>
        new Response(JSON.stringify({ status: true, data }));
      let directSignal: AbortSignal | undefined;
      input.fetchImplementation
        .mockReset()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(() => resolve(envelope(fixture.wallet)), 8_000);
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              setTimeout(
                () =>
                  resolve(
                    envelope({
                      ...fixture.page,
                      pageInfo: {
                        hasNextPage: true,
                        endCursor: 'later-page',
                      },
                    })
                  ),
                8_000
              );
            })
        )
        .mockImplementationOnce((_url, init) => {
          directSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        });

      const result = resolvePrimaryWalletSavingsIdentity(input);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(limits.timeBudgetMs - 16_001);
      expect(directSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBeNull();
      expect(directSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
