import '@testing-library/jest-dom/vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NetworkError } from '@/lib/api-errors';

const mocks = vi.hoisted(() => ({
  thread: vi.fn(),
  api: vi.fn(),
  refetch: vi.fn(),
  back: vi.fn(),
  choose: vi.fn(),
  customer: vi.fn(),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: mocks.back },
}));
vi.mock('@/components/ui/AppSheetModal', () => ({
  AppSheetModal: ({
    children,
    visible,
  }: {
    children: ReactNode;
    visible: boolean;
  }) => (visible ? <div>{children}</div> : null),
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: LIGHT_COLORS }),
}));
vi.mock('@/hooks/useInboxCustomer', () => ({
  useInboxCustomer: () => mocks.customer(),
}));
vi.mock('@/hooks/useInboxThread', () => ({
  useInboxThread: () => mocks.thread(),
}));
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { apiClient: mocks.api, NetworkError: errors.NetworkError };
});
vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { messages, renderThread } from './ConversationThread.test-support';

describe('ConversationThread business tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.mockReturnValue({ data: null });
    mocks.refetch.mockResolvedValue({
      isError: false,
      data: { pages: [{ messages }] },
    });
    mocks.thread.mockReturnValue({
      conversation: {
        id: 9,
        status: 'open',
        unreadCount: 0,
        customerName: 'Ada Test',
        lastActivityAt: null,
        lastMessage: null,
        tags: ['payment'],
        priority: 'high',
        followUp: false,
      },
      messages,
      merchantId: 'm1',
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: mocks.refetch,
    });
  });

  it('shows the current priority and tag count on the action bar', () => {
    renderThread();
    expect(screen.getByRole('button', { name: 'High' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tags (1)' })
    ).toBeInTheDocument();
  });

  it('marks the chat Done and goes back to the list', async () => {
    mocks.api.mockResolvedValue({
      conversation: {
        id: 9,
        status: 'resolved',
        unreadCount: 0,
        customerName: 'Ada Test',
        lastActivityAt: null,
        lastMessage: null,
      },
    });
    renderThread();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(mocks.back).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.api.mock.calls[0];
    expect(url).toBe('/api/merchant/inbox/conversations/9');
    expect(JSON.parse(init.body)).toEqual({ status: 'resolved' });
  });

  it('sends the chosen follow-up time', async () => {
    mocks.api.mockResolvedValue({
      conversation: {
        id: 9,
        status: 'snoozed',
        unreadCount: 0,
        customerName: 'Ada Test',
        lastActivityAt: null,
        lastMessage: null,
      },
    });
    renderThread();

    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }));
    fireEvent.click(screen.getByRole('button', { name: 'In 3 days' }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({
      followUpAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it('does not leave the chat when Done could not be saved', async () => {
    mocks.api.mockRejectedValue(new NetworkError('no', { statusCode: 503 }));
    renderThread();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.back).not.toHaveBeenCalled();
  });
});

describe('ConversationThread customer card', () => {
  const profile = {
    name: 'Ada Obi',
    currency: 'NGN',
    memberSince: null,
    orderCount: 5,
    totalSpent: 412000,
    loyaltyPoints: 0,
    recentOrders: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.thread.mockReturnValue({
      conversation: {
        id: 9,
        status: 'open',
        unreadCount: 0,
        customerName: 'small-meadow-890',
        lastActivityAt: null,
        lastMessage: null,
      },
      messages,
      merchantId: 'm1',
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: mocks.refetch,
    });
  });

  it('shows who is writing when the chat is linked to a signed-in customer', () => {
    mocks.customer.mockReturnValue({ data: profile });
    renderThread();
    expect(screen.getByText('Ada Obi')).toBeInTheDocument();
    expect(
      screen.getByText(/Returning customer · 5 orders/)
    ).toBeInTheDocument();
  });

  it('shows no card for a guest chat', () => {
    mocks.customer.mockReturnValue({ data: null });
    renderThread();
    expect(screen.queryByText(/Returning customer/)).toBeNull();
    expect(screen.queryByText(/Signed-in customer/)).toBeNull();
  });
});
