import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { activityItem } from '@/components/wallet/activity/activity-test-harness.test-support';
import { usePiggyvestWalletActivity } from './use-piggyvest-wallet-activity';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'customer-1' } }),
}));
const mockFocus: { current: () => void } = { current: () => undefined };
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    mockFocus.current = callback;
  },
}));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const page1 = {
  items: [activityItem({ id: '00000000-0000-4000-8000-0000000000a1' })],
  nextCursor: 'c2',
};
const page2 = {
  items: [activityItem({ id: '00000000-0000-4000-8000-0000000000b1' })],
  nextCursor: null,
};
const cursors = () =>
  mockFetch.mock.calls.map((call) => (call[0] as { cursor: unknown }).cursor);

function setup(staleTime = 0) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, staleTime },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const render = (refreshKey = 1) =>
    renderHook(
      ({ key }: { key: number }) =>
        usePiggyvestWalletActivity({
          merchantId: MERCHANT,
          enabled: true,
          refreshKey: key,
        }),
      { wrapper, initialProps: { key: refreshKey } }
    );
  return { render, client };
}

describe('bugfix: reopening the wallet re-read every loaded page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reloads only the first page when the wallet refreshes after "Show more"', async () => {
    mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    mockFetch.mockResolvedValue(page1);
    const { result, rerender } = setup().render(1);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    rerender({ key: 2 });

    await waitFor(() => expect(cursors()).toEqual([null, 'c2', null]));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it('keeps only the first page when the wallet is left and reopened', async () => {
    mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    mockFetch.mockResolvedValue(page1);
    const env = setup();
    const first = env.render();
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.items).toHaveLength(2));
    first.unmount();

    const second = env.render();

    await waitFor(() => expect(cursors()).toEqual([null, 'c2', null]));
    await waitFor(() => expect(second.result.current.items).toHaveLength(1));
  });

  it('a "Show more" still loading when the wallet is left cannot restore the extra page', async () => {
    let finishPage2: (page: unknown) => void = () => undefined;
    mockFetch.mockResolvedValueOnce(page1).mockReturnValueOnce(
      new Promise((resolve) => {
        finishPage2 = resolve;
      })
    );
    const env = setup();
    const first = env.render();
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.isLoadingMore).toBe(true));

    first.unmount();
    await act(async () => finishPage2(page2));

    const cached = env.client.getQueryData<{ pages: unknown[] }>([
      'piggyvest-wallet-activity',
      MERCHANT,
      'customer-1',
    ]);
    expect(cached?.pages).toHaveLength(1);
  });

  it('trimming the list on leave keeps the time page 1 was read', async () => {
    mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const env = setup();
    const first = env.render();
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.items).toHaveLength(2));
    const key = ['piggyvest-wallet-activity', MERCHANT, 'customer-1'];
    const readAt = env.client.getQueryState(key)?.dataUpdatedAt;

    first.unmount();

    await waitFor(() =>
      expect(
        env.client.getQueryData<{ pages: unknown[] }>(key)?.pages
      ).toHaveLength(1)
    );
    expect(env.client.getQueryState(key)?.dataUpdatedAt).toBe(readAt);
  });

  it('reloads page 1 on reopening once the trimmed list is older than five minutes', async () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    try {
      mockFetch.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      mockFetch.mockResolvedValue(page1);
      // The app's own setting: data is fresh for five minutes.
      const env = setup(5 * 60_000);
      const first = env.render();
      await waitFor(() => expect(first.result.current.items).toHaveLength(1));
      act(() => first.result.current.loadMore());
      await waitFor(() => expect(first.result.current.items).toHaveLength(2));

      now.mockReturnValue(start + 6 * 60_000);
      first.unmount();
      const second = env.render();

      await waitFor(() => expect(cursors()).toEqual([null, 'c2', null]));
      await waitFor(() => expect(second.result.current.items).toHaveLength(1));
    } finally {
      now.mockRestore();
    }
  });

  it('a return to the screen during "Show more" re-reads page 1 once it ends', async () => {
    let finishPage2: (page: unknown) => void = () => undefined;
    mockFetch.mockResolvedValueOnce(page1).mockReturnValueOnce(
      new Promise((resolve) => {
        finishPage2 = resolve;
      })
    );
    mockFetch.mockResolvedValue(page1);
    const { result } = setup().render();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => mockFocus.current()); // the mount focus is skipped
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(true));

    act(() => mockFocus.current());
    expect(cursors()).toEqual([null, 'c2']);
    await act(async () => finishPage2(page2));

    await waitFor(() => expect(cursors()).toEqual([null, 'c2', null]));
  });

  it('re-reads the first page when the wallet screen regains focus', async () => {
    mockFetch.mockResolvedValue(page1);
    const { result } = setup().render();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => mockFocus.current()); // the mount focus is skipped
    expect(mockFetch).toHaveBeenCalledTimes(1);
    act(() => mockFocus.current());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(cursors()).toEqual([null, null]);
  });
});

describe('bugfix: "Show more" spun for about a minute on a hung server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gives load-more one short attempt and no retry, keeping the rows', async () => {
    mockFetch
      .mockResolvedValueOnce(page1)
      .mockRejectedValue(new Error('timed out'));
    const { result } = setup().render();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.loadMoreFailed).toBe(true));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const input = mockFetch.mock.calls[1][0] as { timeoutMs?: number };
    expect(input.timeoutMs).toBeLessThanOrEqual(25_000);
    expect(result.current.items).toHaveLength(1);
  });

  it('still retries the first page once', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(page1);
    const { result } = setup().render();

    await waitFor(() => expect(result.current.items).toHaveLength(1), {
      timeout: 4000,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
