import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
  query: vi.fn(),
  search: vi.fn(),
}));

vi.mock('expo-router', () => ({ router: { push: mocks.push } }));
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

const ready = (conversations: ReturnType<typeof conversation>[]) =>
  readyQuery(conversations, mocks);

describe('MessagesScreen search and paging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockReturnValue(idleSearch(vi.fn(), vi.fn()));
  });

  it('shows search results with the matching words instead of the chip list', () => {
    mocks.query.mockReturnValue(
      ready([conversation(1, 'Ada Test', 'customer')])
    );
    mocks.search.mockReturnValue({
      isError: false,
      isLoadingMore: false,
      isPending: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
      results: [
        {
          conversation: conversation(8, 'Zed Test', 'store'),
          snippet: 'where is my order 1234',
        },
      ],
    });
    render(<MessagesScreen />);

    fireEvent.change(screen.getByLabelText('Search chats'), {
      target: { value: 'order' },
    });

    expect(mocks.search).toHaveBeenLastCalledWith('order');
    expect(screen.getByText('where is my order 1234')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow-up' })).toBeNull();
  });

  it('says so when a search finds nothing, and clears back to the list', () => {
    mocks.query.mockReturnValue(
      ready([conversation(1, 'Ada Test', 'customer')])
    );
    render(<MessagesScreen />);

    fireEvent.change(screen.getByLabelText('Search chats'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No chats match "zzz"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Ada Test')).toBeInTheDocument();
  });

  it('bugfix: does not request the next page again after a page failed', () => {
    mocks.query.mockReturnValue({
      ...ready([conversation(1, 'Ada Test', 'customer')]),
      hasNextPage: true,
      isFetchNextPageError: true,
    });
    render(<MessagesScreen />);

    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('offers an explicit retry for the failed page', () => {
    mocks.query.mockReturnValue({
      ...ready([conversation(1, 'Ada Test', 'customer')]),
      hasNextPage: true,
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

  it('keeps loading more pages for a ranked view when nothing failed', () => {
    mocks.query.mockReturnValue({
      ...ready([conversation(1, 'Ada Test', 'customer')]),
      hasNextPage: true,
    });
    render(<MessagesScreen />);

    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  const emptyPages = (count: number) => ({
    ...ready([]),
    hasNextPage: true,
    data: {
      pages: Array.from({ length: count }, (_, i) => ({
        conversations: [],
        hasMore: true,
        page: i + 1,
      })),
    },
  });

  it('bugfix: ends in the empty message, not a spinner, when every page was narrowed to nothing', () => {
    // Five pages loaded and empty, the server still says there are more.
    mocks.query.mockReturnValue(emptyPages(5));
    render(<MessagesScreen />);

    expect(screen.getByText('You are all caught up')).toBeInTheDocument();
    expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  });

  it('lets the person look further back from that empty message', () => {
    mocks.query.mockReturnValue(emptyPages(5));
    render(<MessagesScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }));

    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner while the first pages are still being loaded automatically', () => {
    mocks.query.mockReturnValue(emptyPages(2));
    render(<MessagesScreen />);

    expect(screen.queryByText('You are all caught up')).toBeNull();
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });
});
