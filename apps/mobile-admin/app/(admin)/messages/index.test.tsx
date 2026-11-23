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

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('@/components/ui/KeyboardInsetView', () => ({
  KeyboardInsetView: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
  FlashList: (await import('./index.test-support')).FlashListMock,
}));

import MessagesScreen from './index';
import { conversation, idleSearch, readyQuery } from './index.test-support';

const ready = (conversations: ReturnType<typeof conversation>[]) =>
  readyQuery(conversations, mocks);

describe('MessagesScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockReturnValue(idleSearch(vi.fn(), vi.fn()));
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
});
