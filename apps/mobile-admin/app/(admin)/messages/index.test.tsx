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
}));

vi.mock('expo-router', () => ({ router: { push: mocks.push } }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: LIGHT_COLORS }),
}));
vi.mock('@/hooks/useInboxConversations', () => ({
  useInboxConversations: () => mocks.query(),
}));
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { NetworkError: errors.NetworkError };
});
vi.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data = [],
    ListEmptyComponent,
    renderItem,
  }: {
    data?: unknown[];
    ListEmptyComponent?: ReactNode;
    renderItem: (input: { index: number; item: unknown }) => ReactNode;
  }) => (
    <div>
      {data.length === 0
        ? ListEmptyComponent
        : data.map((item, index) => (
            <div key={index}>{renderItem({ item, index })}</div>
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
  beforeEach(() => vi.clearAllMocks());

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
    expect(screen.getAllByText(/needs reply/i)).toHaveLength(1);
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
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
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
});
