import { describe, expect, it, vi } from 'vitest';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';

describe('primary savings date locator fallback', () => {
  it('reserves budget for unfiltered evidence after a slow filtered scan', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const input = requestInput([fixture.page], fixture.wallet, 'production', {
        ...fixture.singleTransaction,
        created_at: '2024-06-15T12:00:00.000Z',
      });
      const defaultFetch = input.fetchImplementation.getMockImplementation();
      let filteredPages = 0;
      let timedOutSignal: AbortSignal | undefined;
      input.fetchImplementation.mockImplementation((url, init) => {
        const parsedUrl = new URL(String(url));
        if (parsedUrl.searchParams.has('start_date')) {
          filteredPages += 1;
          if (filteredPages === 1) {
            const page = {
              ...fixture.page,
              edges: [{ id: 'unrelated-filtered-row' }],
              pageInfo: { hasNextPage: true, endCursor: 'filtered-next' },
            };
            return new Promise<Response>((resolve) => {
              setTimeout(
                () =>
                  resolve(
                    new Response(JSON.stringify({ status: true, data: page }))
                  ),
                8_000
              );
            });
          }
          timedOutSignal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        }
        return defaultFetch?.(url, init) ?? Promise.resolve(new Response());
      });

      const startedAt = performance.now();
      const result = resolvePrimaryWalletSavingsIdentity(input);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(filteredPages).toBe(2);
      await vi.advanceTimersByTimeAsync(7_000);

      await expect(result).resolves.toMatchObject({
        environment: 'production',
        transaction: fixture.transaction,
      });
      expect(timedOutSignal?.aborted).toBe(true);
      expect(
        startedAt + limits.timeBudgetMs - performance.now()
      ).toBeGreaterThanOrEqual(limits.unfilteredFallbackReserveMs);
      const calls = input.fetchImplementation.mock.calls;
      const unfilteredUrl = new URL(String(calls[calls.length - 1][0]));
      expect(unfilteredUrl.searchParams.has('start_date')).toBe(false);
      expect(unfilteredUrl.searchParams.has('end_date')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed on HTTP 409 from the filtered locator without an unfiltered retry', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'production', {
      ...fixture.singleTransaction,
      created_at: '2024-06-15T12:00:00.000Z',
    });
    const defaultFetch = input.fetchImplementation.getMockImplementation();
    input.fetchImplementation.mockImplementation((url, init) =>
      new URL(String(url)).searchParams.has('start_date')
        ? Promise.resolve(
            new Response(JSON.stringify({ message: 'Conflict' }), {
              status: 409,
            })
          )
        : (defaultFetch?.(url, init) ?? Promise.resolve(new Response()))
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
    expect(input.fetchImplementation).toHaveBeenCalledTimes(3);
    const locatorUrl = new URL(
      String(input.fetchImplementation.mock.calls[2][0])
    );
    expect(locatorUrl.searchParams.has('start_date')).toBe(true);
  });

  it('falls back to the reserved unfiltered scan when the filtered request is unavailable', async () => {
    const input = requestInput([fixture.page], fixture.wallet, 'production', {
      ...fixture.singleTransaction,
      created_at: '2024-06-15T12:00:00.000Z',
    });
    const defaultFetch = input.fetchImplementation.getMockImplementation();
    input.fetchImplementation.mockImplementation((url, init) =>
      new URL(String(url)).searchParams.has('start_date')
        ? Promise.reject(new Error('temporary network failure'))
        : (defaultFetch?.(url, init) ?? Promise.resolve(new Response()))
    );

    expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
      environment: 'production',
      transaction: fixture.transaction,
    });
    expect(input.fetchImplementation).toHaveBeenCalledTimes(4);
    const fallbackUrl = new URL(
      String(input.fetchImplementation.mock.calls[3][0])
    );
    expect(fallbackUrl.searchParams.has('start_date')).toBe(false);
    expect(fallbackUrl.searchParams.has('end_date')).toBe(false);
  });
});
