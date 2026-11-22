import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NetworkError } from '@/lib/api-errors';

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
vi.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data = [],
    keyExtractor,
    ListEmptyComponent,
    ListHeaderComponent,
    renderItem,
  }: {
    data?: unknown[];
    keyExtractor?: (item: unknown, index: number) => string;
    ListEmptyComponent?: ReactNode;
    ListHeaderComponent?: ReactNode;
    renderItem: (input: { index: number; item: unknown }) => ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length === 0
        ? ListEmptyComponent
        : data.map((item, index) => (
            <div
              key={
                keyExtractor ? keyExtractor(item, index) : JSON.stringify(item)
              }
            >
              {renderItem({ item, index })}
            </div>
          ))}
    </div>
  ),
}));

import MessagesScreen from './index';

const conversation = (
  id: number,
  name: string,
  sender: 'customer' | 'store'
) => ({
  id,
  status: 'open' as const,
  unreadCount: sender === 'customer' ? 2 : 0,
  customerName: name,
  lastActivityAt: new Date().toISOString(),
  lastMessage: {
    id: id * 10,
    sender,
    kind: 'text' as const,
    text: `Hello from ${name}`,
    createdAt: new Date().toISOString(),
  },
});

const ready = (conversations: ReturnType<typeof conversation>[]) => ({
  data: { pages: [{ conversations, hasMore: false, page: 1 }] },
  error: null,
  fetchNextPage: mocks.fetchNextPage,
  hasNextPage: false,
  isError: false,
  isFetchingNextPage: false,
  isLoading: false,
  refetch: mocks.refetch,
});

describe('MessagesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockReturnValue({
      isError: false,
      isPending: false,
      results: [],
    });
  });

  it('lists conversations with preview and a needs-reply badge', () => {
    mocks.query.mockReturnValue(
      ready([
        conversation(1, 'Ada Test', 'customer'),
        conversation(2, 'Bo Test', 'store'),
      ])
    );
    render(<MessagesScreen />);

    expect(screen.getByText('Ada Test')).toBeInTheDocument();
    expect(screen.getByText('Hello from Ada Test')).toBeInTheDocument();
    expect(screen.getByText('2 new · needs reply')).toBeInTheDocument();
    expect(screen.getAllByText(/· needs reply/i)).toHaveLength(1);
  });

  it('bugfix: shows only the unread count, not needs reply, when the store answered last', () => {
    const answered = { ...conversation(3, 'Cy Test', 'store'), unreadCount: 1 };
    mocks.query.mockReturnValue(ready([answered]));
    render(<MessagesScreen />);

    expect(screen.getByText('1 new')).toBeInTheDocument();
    expect(screen.queryByText(/· needs reply/i)).toBeNull();
  });

  it('opens the thread for the tapped conversation', () => {
    mocks.query.mockReturnValue(
      ready([conversation(42, 'Ada Test', 'customer')])
    );
    render(<MessagesScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Ada Test/ }));

    expect(mocks.push).toHaveBeenCalledWith('/(admin)/messages/42');
  });

  it('shows an empty state when there are no conversations', () => {
    mocks.query.mockReturnValue(ready([]));
    render(<MessagesScreen />);
    expect(screen.getByText('You are all caught up')).toBeInTheDocument();
  });

  it('shows a retry when loading fails', () => {
    mocks.query.mockReturnValue({
      ...ready([]),
      data: undefined,
      error: new Error('down'),
      isError: true,
    });
    render(<MessagesScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Tap to retry' }));

    expect(screen.getByText(/Could not load messages/)).toBeInTheDocument();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('explains a missing permission instead of a generic error', () => {
    mocks.query.mockReturnValue({
      ...ready([]),
      data: undefined,
      error: new NetworkError('no', { statusCode: 403 }),
      isError: true,
    });
    render(<MessagesScreen />);
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();
  });

  it('opens on Needs reply and counts the chats waiting', () => {
    mocks.query.mockReturnValue(
      ready([
        conversation(1, 'Ada Test', 'customer'),
        conversation(2, 'Bo Test', 'customer'),
      ])
    );
    render(<MessagesScreen />);

    expect(mocks.query).toHaveBeenCalledWith('needs_reply');
    expect(
      screen.getByText('2 chats are waiting for your reply')
    ).toBeInTheDocument();
  });

  it('switches view when a chip is tapped and loads that view', () => {
    mocks.query.mockReturnValue(ready([]));
    render(<MessagesScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Follow-up' }));

    expect(mocks.query).toHaveBeenLastCalledWith('follow_up');
    expect(screen.getByText('No follow-ups')).toBeInTheDocument();
  });

  it('puts the longest-waiting chat first and lets priority lead', () => {
    const old = {
      ...conversation(1, 'Old Test', 'customer'),
      lastActivityAt: '2026-11-20T08:00:00.000Z',
      lastMessage: {
        ...conversation(1, 'Old Test', 'customer').lastMessage,
        createdAt: '2026-11-20T08:00:00.000Z',
      },
    };
    const fresh = conversation(2, 'Fresh Test', 'customer');
    const urgent = {
      ...conversation(3, 'Urgent Test', 'customer'),
      priority: 'urgent' as const,
    };
    mocks.query.mockReturnValue(ready([fresh, old, urgent]));
    render(<MessagesScreen />);

    const names = screen
      .getAllByRole('button', { name: /Conversation with/ })
      .map((row) => row.getAttribute('aria-label'));
    expect(names[0]).toContain('Urgent Test');
    expect(names[1]).toContain('Old Test');
    expect(names[2]).toContain('Fresh Test');
  });

  it('shows tags, priority and follow-up on a row', () => {
    const tagged = {
      ...conversation(5, 'Tag Test', 'customer'),
      tags: ['order-issue'],
      priority: 'high' as const,
    };
    mocks.query.mockReturnValue(ready([tagged]));
    render(<MessagesScreen />);

    expect(screen.getByText('Order issue')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows search results with the matching words instead of the chip list', () => {
    mocks.query.mockReturnValue(
      ready([conversation(1, 'Ada Test', 'customer')])
    );
    mocks.search.mockReturnValue({
      isError: false,
      isPending: false,
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
});
