import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  query: vi.fn(),
  search: vi.fn(),
}));

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: LIGHT_COLORS }),
}));
vi.mock('@/hooks/useInboxConversations', () => ({
  useInboxConversations: (view?: string) => mocks.query(view),
}));
vi.mock('@/hooks/useInboxSearch', () => ({
  useInboxSearch: (term: string) => mocks.search(term),
}));
vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { NetworkError: errors.NetworkError };
});
vi.mock('@shopify/flash-list', async () => ({
  FlashList: (await import('./index.test-support')).FlashListMock,
}));

import MessagesScreen from './index';
import { conversation, idleSearch, readyQuery } from './index.test-support';

/** The default Needs reply view, with older pages still to load. */
const withMorePages = (fetching: boolean) => ({
  ...readyQuery([conversation(1, 'Ada Test', 'customer')], mocks),
  hasNextPage: true,
  isFetching: fetching,
});

describe('MessagesScreen automatic paging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockReturnValue(idleSearch(vi.fn(), vi.fn()));
  });

  it('loads the next page of a ranked view once nothing is being fetched', () => {
    mocks.query.mockReturnValue(withMorePages(false));
    render(<MessagesScreen />);

    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('bugfix: waits for a refresh of the cached pages instead of cancelling it', () => {
    // fetchNextPage cancels a refresh still running, which would throw the
    // refreshed first page away and leave the stale one on screen.
    mocks.query.mockReturnValue(withMorePages(true));
    render(<MessagesScreen />);

    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('bugfix: says "at least" when more waiting chats are still to be loaded', () => {
    // Fetching, so nothing else loads: the count is only what has arrived.
    mocks.query.mockReturnValue(withMorePages(true));
    render(<MessagesScreen />);

    expect(
      screen.getByText('1+ chats are waiting for your reply')
    ).toBeInTheDocument();
  });

  it('gives an exact count once every waiting chat has loaded', () => {
    mocks.query.mockReturnValue({
      ...withMorePages(false),
      hasNextPage: false,
    });
    render(<MessagesScreen />);

    expect(
      screen.getByText('1 chat is waiting for your reply')
    ).toBeInTheDocument();
  });
});
