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
  isFocused: vi.fn(),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: mocks.back },
  useNavigation: () => ({ isFocused: mocks.isFocused }),
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

import { at, messages, renderThread } from './ConversationThread.test-support';

describe('ConversationThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customer.mockReturnValue({ data: null });
    mocks.isFocused.mockReturnValue(true);
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
