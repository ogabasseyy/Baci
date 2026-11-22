import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/components/ui/showChoiceSheet', () => ({
  showChoiceSheet: mocks.choose,
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

import { ConversationThread } from './ConversationThread';

const at = (m: number) => `2026-11-22T10:0${m}:00Z`;
const messages = [
  {
    id: 1,
    sender: 'customer',
    kind: 'text',
    text: 'Is the phone in stock?',
    createdAt: at(0),
  },
  {
    id: 2,
    sender: 'assistant',
    kind: 'text',
    text: 'Let me check for you.',
    createdAt: at(1),
  },
  {
    id: 3,
    sender: 'store',
    kind: 'text',
    text: 'Yes we have it',
    createdAt: at(2),
  },
];

function renderThread() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationThread conversationId={9} />
    </QueryClientProvider>
  );
}

describe('ConversationThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.mockReturnValue({ data: null });
    mocks.refetch.mockResolvedValue({
      isError: false,
      data: { pages: [{ messages }] },
    });
    mocks.thread.mockReturnValue({
      conversation: { customerName: 'Ada Test' },
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

  it('shows shopper, assistant and store messages as distinct', () => {
    renderThread();

    expect(screen.getByText('Is the phone in stock?')).toBeInTheDocument();
    expect(screen.getByText('Assistant (automatic reply)')).toBeInTheDocument();
    expect(screen.getByText(/^You · /)).toBeInTheDocument();
  });

  it('shows an error with retry when the thread cannot load', () => {
    mocks.thread.mockReturnValue({
      ...mocks.thread(),
      messages: [],
      isError: true,
    });
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to retry' }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it('sends a reply and clears the box', async () => {
    mocks.api.mockResolvedValue({
      message: {
        id: 4,
        sender: 'store',
        kind: 'text',
        text: 'Come by today',
        createdAt: at(3),
      },
    });
    renderThread();

    fireEvent.change(screen.getByLabelText('Reply'), {
      target: { value: 'Come by today' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Reply')).toHaveValue(''));
  });

  it('keeps the text and offers Retry when sending fails', async () => {
    mocks.api.mockRejectedValue(new NetworkError('no', { statusCode: 403 }));
    renderThread();

    fireEvent.change(screen.getByLabelText('Reply'), {
      target: { value: 'Come by today' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText(/Message not sent/)).toBeInTheDocument();
    expect(screen.getByLabelText('Reply')).toHaveValue('Come by today');
    expect(screen.getByRole('button', { name: 'Retry sending' })).toBeEnabled();
  });
});

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
    mocks.choose.mockResolvedValue('2026-11-23T08:00:00.000Z');
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

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({
      followUpAt: '2026-11-23T08:00:00.000Z',
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
