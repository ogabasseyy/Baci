import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listPrimarySavingsProvisioningWallets } from './primary-savings-provisioning-pagination';
import { primarySavingsProvisioningPaginationLimits as limits } from './primary-savings-provisioning-pagination.constants';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./client', () => ({ piggyvestRequest: mocks.request }));
const config = { token: 'test-only-token' };
const input = {
  customerId: 'customer-with-hyphens',
  walletName: 'baci-save:integration:goal',
};
const target = {
  id: 'wallet-with-hyphens',
  name: input.walletName,
  status: 'active',
};
function page(
  edges = [target],
  hasNextPage = false,
  endCursor: string | null = 'terminal'
) {
  return { paginatedPayload: { edges, pageInfo: { hasNextPage, endCursor } } };
}
function list() {
  return listPrimarySavingsProvisioningWallets(config, input);
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

it('finds the exact second-page wallet with the existing GET transport and unchanged opaque cursor', async () => {
  const cursor = '2024-01-30T07:40:49.000Z+opaque';
  mocks.request
    .mockResolvedValueOnce(
      page([{ ...target, id: 'other', name: 'unrelated' }], true, cursor)
    )
    .mockResolvedValueOnce(page());
  expect(await list()).toEqual([target]);
  expect(mocks.request).toHaveBeenNthCalledWith(
    2,
    config,
    expect.anything(),
    '/api/v1/wallet/api/wallet-type',
    {
      method: 'GET',
      query: {
        customer_id: input.customerId,
        limit: '100',
        orderBy: 'ASC',
        cursor,
      },
    }
  );
});
it('retains ambiguity across pages rather than choosing the first exact name', async () => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'next'))
    .mockResolvedValueOnce(page([{ ...target, id: 'second-wallet' }]));
  expect(await list()).toEqual([target, { ...target, id: 'second-wallet' }]);
});
it('finds the wallet under the name the provider rewrote, without touching the customer id', async () => {
  // Sandbox, 2026-10-31: PiggyVest listed a created wallet back with every
  // `-` removed. Case and other punctuation are not proven either way.
  const rewritten = { ...target, name: 'BACISAVEINTEGRATIONGOAL' };
  mocks.request.mockResolvedValue(page([rewritten]));
  expect(await list()).toEqual([rewritten]);
  expect(mocks.request.mock.calls[0][3].query.customer_id).toBe(
    'customer-with-hyphens'
  );
});
it('reports a complete listing without a match as an empty list, never as unknown', async () => {
  mocks.request.mockResolvedValueOnce(page([{ ...target, name: 'other' }]));
  expect(await list()).toEqual([]);
});
it('does not match near-matching wallet names', async () => {
  mocks.request.mockResolvedValue(
    page([
      { ...target, name: 'baci-save:integration:goal2' },
      { ...target, id: 'w2', name: 'baci-save:integration:goa' },
      { ...target, id: 'w3', name: 'baci-save:other:goal' },
    ])
  );
  expect(await list()).toEqual([]);
});
it('keeps an exact and a rewritten name as two matches so the caller refuses both', async () => {
  const rewritten = {
    ...target,
    id: 'second-wallet',
    name: 'bacisaveintegrationgoal',
  };
  mocks.request.mockResolvedValue(page([target, rewritten]));
  expect(await list()).toEqual([target, rewritten]);
});
it('discards an exact first-page match if a later request fails', async () => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'next'))
    .mockRejectedValueOnce(new Error('Synthetic failure'));
  expect(await list()).toBeNull();
});
it.each([
  false,
  true,
])('discards repeated cursors on a terminal or continuing page: %s', async (hasNextPage) => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'same'))
    .mockResolvedValueOnce(
      page([{ ...target, id: 'other' }], hasNextPage, 'same')
    );
  expect(await list()).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
it('discards a multi-page cursor cycle', async () => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'first'))
    .mockResolvedValueOnce(page([{ ...target, id: 'other' }], true, 'second'))
    .mockResolvedValueOnce(page([{ ...target, id: 'third' }], true, 'first'));
  expect(await list()).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(3);
});
it('discards duplicate wallet IDs across pages even with different cursors', async () => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'first'))
    .mockResolvedValueOnce(page());
  expect(await list()).toBeNull();
});
it.each([
  false,
  true,
])('rejects an empty later page instead of treating a partial list as complete: %s', async (hasNextPage) => {
  mocks.request
    .mockResolvedValueOnce(page([target], true, 'first'))
    .mockResolvedValueOnce(page([], hasNextPage));
  expect(await list()).toBeNull();
});
it('bounds traversal to ten pages and never accepts an incomplete matching list', async () => {
  mocks.request.mockImplementation(async () =>
    page(
      [{ ...target, id: `wallet-${mocks.request.mock.calls.length}` }],
      true,
      `cursor-${mocks.request.mock.calls.length}`
    )
  );
  expect(await list()).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(limits.maxPages);
});
it('accepts a complete tenth page and retains at most two ambiguity witnesses', async () => {
  mocks.request.mockImplementation(async () =>
    page(
      [{ ...target, id: `wallet-${mocks.request.mock.calls.length}` }],
      mocks.request.mock.calls.length < limits.maxPages,
      `cursor-${mocks.request.mock.calls.length}`
    )
  );
  expect(await list()).toHaveLength(2);
  expect(mocks.request).toHaveBeenCalledTimes(limits.maxPages);
});
it('reports an unknown listing (null) at the shared deadline and ignores late results', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let complete: ((value: ReturnType<typeof page>) => void) | undefined;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const result = list();
  await vi.advanceTimersByTimeAsync(limits.timeBudgetMs);
  expect(await result).toBeNull();
  complete?.(page([target], true, 'late'));
  await Promise.resolve();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('shares one time budget across pages rather than resetting per page', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let complete: ((value: ReturnType<typeof page>) => void) | undefined;
  mocks.request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    )
    .mockImplementationOnce(() => new Promise(() => {}));
  const result = list();
  await vi.advanceTimersByTimeAsync(limits.timeBudgetMs - 1);
  complete?.(page([target], true, 'first'));
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeNull();
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
