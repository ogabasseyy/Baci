import { describe, expect, it, vi } from 'vitest';
import { listPiggyvestAccruedInterest } from './wallet-interest';

describe('listPiggyvestAccruedInterest', () => {
  it('returns one explicit page with its cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          message: 'Fetched wallet interest accrual',
          data: {
            paginatedPayload: {
              edges: [
                {
                  id: 'accrual-1',
                  wallet_id: 'wallet-1',
                  amount: 5000,
                  balance: 5000000,
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            },
          },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const page = await listPiggyvestAccruedInterest(
      { token: 'synthetic-token' },
      { walletId: 'wallet-1', limit: 31 }
    );

    expect(page.accruals).toHaveLength(1);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBe('cursor-1');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('interest_type=original');
    vi.unstubAllGlobals();
  });
});
