import { describe, expect, it, vi } from 'vitest';
import {
  CREDIT_LIST_MAX_PAGES,
  createWalletPageReader,
  listWalletCreditsSince,
} from './credit-gap-provider-reader';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-provider-request', () => ({
  requestPrefundedCardProviderJson: vi.fn(async () => ({})),
}));

const SINCE = Date.parse('2026-11-08T00:00:00.000Z');

function row(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    amount: 5000,
    type: 'credit',
    status: 'successful',
    category: 'bank-inflow',
    description: 'Synthetic',
    wallet_id: 'plan-wallet-a',
    wallet_type: 'api',
    created_at: createdAt,
    ...overrides,
  };
}

function page(edges: unknown[], endCursor: string | null = null) {
  return {
    status: true,
    data: {
      edges,
      pageInfo: {
        hasNextPage: endCursor !== null,
        endCursor,
        previousCursor: null,
      },
    },
  };
}

describe('listWalletCreditsSince', () => {
  it('keeps credits since the window start and stops at the first older row', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          [
            row('PVB01NEW', '2026-11-10T00:00:00Z'),
            row('PVB01DEBIT', '2026-11-09T00:00:00Z', { type: 'debit' }),
          ],
          'next'
        )
      )
      .mockResolvedValueOnce(
        page(
          [
            row('PVB01MID', '2026-11-08T12:00:00Z'),
            row('PVB01OLD', '2026-11-01T00:00:00Z'),
          ],
          'later'
        )
      );

    const listing = await listWalletCreditsSince({
      walletId: 'plan-wallet-a',
      sinceMs: SINCE,
      listPage,
    });

    expect(listing).toEqual({
      outcome: 'complete',
      credits: [
        expect.objectContaining({
          id: 'PVB01NEW',
          category: 'bank-inflow',
          amountKobo: 5000,
        }),
        expect.objectContaining({ id: 'PVB01MID' }),
      ],
    });
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenLastCalledWith({
      walletId: 'plan-wallet-a',
      cursor: 'next',
    });
  });

  it('reports a list that is not newest first as incomplete instead of stopping early', async () => {
    const listPage = vi.fn(async () =>
      page([
        row('PVB01OLD', '2026-11-01T00:00:00Z'),
        row('PVB01NEW', '2026-11-10T00:00:00Z'),
      ])
    );
    await expect(
      listWalletCreditsSince({
        walletId: 'plan-wallet-a',
        sinceMs: SINCE,
        listPage,
      })
    ).resolves.toEqual({ outcome: 'incomplete', reason: 'order_unexpected' });
  });

  it('stops after the page limit and says the list is incomplete', async () => {
    let n = 0;
    const listPage = vi.fn(async () => {
      n += 1;
      return page(
        [
          row(
            `PVB01P${n}`,
            new Date(
              Date.parse('2026-11-11T00:00:00Z') - n * 60_000
            ).toISOString()
          ),
        ],
        `c${n}`
      );
    });
    await expect(
      listWalletCreditsSince({
        walletId: 'plan-wallet-a',
        sinceMs: SINCE,
        listPage,
      })
    ).resolves.toEqual({ outcome: 'incomplete', reason: 'page_limit' });
    expect(listPage).toHaveBeenCalledTimes(CREDIT_LIST_MAX_PAGES);
  });

  it.each([
    [
      'a failed request',
      () => vi.fn().mockRejectedValue(new Error('PROVIDER_TIMEOUT')),
    ],
    [
      'an unparseable page',
      () => vi.fn().mockResolvedValue({ status: true, data: {} }),
    ],
    [
      'a row for another wallet',
      () =>
        vi
          .fn()
          .mockResolvedValue(
            page([
              row('PVB01X', '2026-11-10T00:00:00Z', { wallet_id: 'other' }),
            ])
          ),
    ],
    [
      'a repeated cursor',
      () =>
        vi
          .fn()
          .mockResolvedValueOnce(
            page([row('PVB01A', '2026-11-10T00:00:00Z')], 'same')
          )
          .mockResolvedValueOnce(
            page([row('PVB01B', '2026-11-09T00:00:00Z')], 'same')
          ),
    ],
  ])('reads %s as unreadable, never as no credits', async (_label, makeListPage) => {
    await expect(
      listWalletCreditsSince({
        walletId: 'plan-wallet-a',
        sinceMs: SINCE,
        listPage: makeListPage(),
      })
    ).resolves.toEqual({ outcome: 'unreadable' });
  });
});

describe('createWalletPageReader', () => {
  it('reads GET /api/v1/transaction for the wallet, with the cursor when given', async () => {
    const read = createWalletPageReader({
      environment: 'staging',
      token: 'synthetic-token',
      fetchImplementation: vi.fn(),
    });
    await read({ walletId: 'plan-wallet-a', cursor: 'abc' });
    const call = vi.mocked(requestPrefundedCardProviderJson).mock.calls[0][0];
    const url = new URL(call.url);
    expect(url.pathname).toBe('/api/v1/transaction');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      wallet_id: 'plan-wallet-a',
      limit: '100',
      collapse_batch: '0',
      cursor: 'abc',
    });
    expect(call.init).toEqual({ method: 'GET' });
  });
});
