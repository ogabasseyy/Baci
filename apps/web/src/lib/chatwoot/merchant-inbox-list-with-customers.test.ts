import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), badges: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./merchant-inbox-client', () => ({
  listMerchantInboxConversations: mocks.list,
}));
vi.mock('./merchant-inbox-customer', () => ({
  loadCustomerBadges: mocks.badges,
}));

import { listConversationsWithCustomers } from './merchant-inbox-list-with-customers';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 } as never;
const supabase = { marker: 'scoped' } as never;

const chat = (id: number) => ({
  id,
  status: 'open' as const,
  unreadCount: 0,
  customerName: `Shopper ${id}`,
  lastActivityAt: null,
  lastMessage: null,
});

const providerPage = (ids: number[], hasMore: boolean) => ({
  ok: true as const,
  conversations: ids.map(chat),
  hasMore,
  links: Object.fromEntries(ids.map((id) => [id, `link-${id}`])),
});

const run = (
  view?: 'returning' | 'needs_reply',
  page = 1,
  canViewOrders = true
) =>
  listConversationsWithCustomers({
    binding,
    supabase,
    merchantId: 'merchant-1',
    canViewOrders,
    page,
    status: 'all',
    view,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.badges.mockResolvedValue({});
});

describe('listConversationsWithCustomers', () => {
  it('reads one page for an ordinary view and attaches customer badges', async () => {
    mocks.list.mockResolvedValue(providerPage([1, 2], true));
    mocks.badges.mockResolvedValue({ 1: { orderCount: 4, totalSpent: 10 } });

    const result = await run('needs_reply', 3);

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(binding, {
      page: 3,
      status: 'all',
      view: 'needs_reply',
    });
    expect(result).toEqual({
      ok: true,
      hasMore: true,
      page: 3,
      conversations: [
        { ...chat(1), customer: { orderCount: 4, totalSpent: 10 } },
        chat(2),
      ],
    });
    expect(mocks.badges).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      links: { 1: 'link-1', 2: 'link-2' },
      includeOrderData: true,
    });
  });

  it('bugfix: asks for no order data when the caller cannot see orders', async () => {
    mocks.list.mockResolvedValue(providerPage([1], false));
    await run('needs_reply', 1, false);
    expect(mocks.badges).toHaveBeenCalledWith(
      expect.objectContaining({ includeOrderData: false })
    );
  });

  it('bugfix: the Customers view is empty, and reads nothing, without order access', async () => {
    await expect(run('returning', 2, false)).resolves.toEqual({
      ok: true,
      conversations: [],
      hasMore: false,
      page: 2,
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.badges).not.toHaveBeenCalled();
  });

  it('answers a failure of the first page as a failure', async () => {
    mocks.list.mockResolvedValue({ ok: false, code: 'unavailable' });
    await expect(run('needs_reply')).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  describe('Customers (returning) view', () => {
    const returning = (ids: number[]) =>
      mocks.badges.mockResolvedValueOnce(
        Object.fromEntries(
          ids.map((id) => [id, { orderCount: 2, totalSpent: 1 }])
        )
      );

    it('stops at the first engine page that has a returning customer', async () => {
      mocks.list.mockResolvedValueOnce(providerPage([1, 2], true));
      returning([2]);

      const result = await run('returning');

      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: true,
        hasMore: true,
        page: 1,
        conversations: [{ id: 2 }],
      });
    });

    it('bugfix: skips engine pages with no returning customer instead of answering empty with more to come', async () => {
      mocks.list
        .mockResolvedValueOnce(providerPage([1], true))
        .mockResolvedValueOnce(providerPage([2], true))
        .mockResolvedValueOnce(providerPage([3], true));
      mocks.badges.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      returning([3]);

      const result = await run('returning');

      expect(mocks.list.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 3]);
      // The next request must start after the page the rows came from.
      expect(result).toMatchObject({ page: 3, conversations: [{ id: 3 }] });
    });

    it('ends with hasMore false when the engine has nothing more', async () => {
      mocks.list
        .mockResolvedValueOnce(providerPage([1], true))
        .mockResolvedValueOnce(providerPage([], false));

      await expect(run('returning')).resolves.toEqual({
        ok: true,
        conversations: [],
        hasMore: false,
        page: 2,
      });
    });

    it('reads at most four engine pages per request, then reports where it got to', async () => {
      mocks.list.mockImplementation(async () => providerPage([9], true));

      const result = await run('returning', 5);

      expect(mocks.list).toHaveBeenCalledTimes(4);
      expect(result).toEqual({
        ok: true,
        conversations: [],
        hasMore: true,
        page: 8,
      });
    });

    it('bugfix: a failure on a later engine page is a failure, not an empty page with more to come', async () => {
      mocks.list
        .mockResolvedValueOnce(providerPage([1], true))
        .mockResolvedValueOnce({ ok: false, code: 'unavailable' });

      await expect(run('returning')).resolves.toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('answers a failure of the very first page as a failure', async () => {
      mocks.list.mockResolvedValueOnce({ ok: false, code: 'unavailable' });
      await expect(run('returning')).resolves.toEqual({
        ok: false,
        code: 'unavailable',
      });
    });
  });
});
