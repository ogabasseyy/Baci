import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  query: vi.fn(),
  search: vi.fn(),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('@/components/ui/KeyboardInsetView', () => ({
  KeyboardInsetView: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
vi.mock('@/components/ui/AppHeaderKeyboardContainer', () => ({
  AppHeaderKeyboardContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { NetworkError: errors.NetworkError };
});
vi.mock('@shopify/flash-list', async () => ({
  FlashList: (await import('@/test/messages-screen-support')).FlashListMock,
}));

import {
  conversation,
  idleSearch,
  readyQuery,
} from '@/test/messages-screen-support';
import MessagesScreen from './index';

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

  it('bugfix: scrolling to the end does not start a page while a refresh is running', () => {
    // fetchNextPage cancels a refresh still running, so the scroll path must
    // wait for it just like the automatic loader does.
    mocks.query.mockReturnValue(withMorePages(true));
    render(<MessagesScreen />);

    fireEvent.click(
      screen.getByRole('button', { name: 'List end reached (test)' })
    );

    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('keeps loading older chats on scroll once nothing is being fetched', () => {
    mocks.query.mockReturnValue(withMorePages(false));
    render(<MessagesScreen />);
    mocks.fetchNextPage.mockClear();

    fireEvent.click(
      screen.getByRole('button', { name: 'List end reached (test)' })
    );

    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('bugfix: the retry for older chats does not cancel a refresh that is running', () => {
    mocks.query.mockReturnValue({
      ...withMorePages(true),
      isFetchNextPageError: true,
    });
    render(<MessagesScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Could not load more chats. Tap to retry.',
      })
    );

    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('retries older chats once nothing is being fetched', () => {
    mocks.query.mockReturnValue({
      ...withMorePages(false),
      isFetchNextPageError: true,
    });
    render(<MessagesScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Could not load more chats. Tap to retry.',
      })
    );

    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
