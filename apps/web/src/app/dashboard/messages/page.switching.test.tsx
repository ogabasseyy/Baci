import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inbox = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/hooks/use-merchant-inbox', () => ({
  useMerchantInbox: () => inbox.value,
}));

vi.mock('./insights-card', () => ({
  InsightsCard: () => <div data-testid="insights-card" />,
}));

import MessagesPage from './page';

const message = (id: number, sender: string, text: string, kind = 'text') => ({
  id,
  sender,
  kind,
  text,
  createdAt: '2026-11-15T06:00:00.000Z',
});
const conversations = [
  {
    id: 7,
    status: 'open',
    unreadCount: 2,
    customerName: 'Ada Synthetic',
    lastActivityAt: '2026-11-15T06:00:00.000Z',
    lastMessage: message(30, 'customer', 'Do you have the Demo Phone X?'),
  },
  {
    id: 8,
    status: 'open',
    unreadCount: 0,
    customerName: 'Bola Synthetic',
    lastActivityAt: null,
    lastMessage: message(41, 'store', 'Yes, we deliver.'),
  },
];

function state(overrides: Record<string, unknown> = {}) {
  return {
    conversations,
    hasMoreConversations: false,
    listState: 'ready',
    messages: [],
    selectConversation: vi.fn(),
    selectedConversation: null,
    selectedId: null,
    sendError: null,
    sendReply: vi.fn(async () => true),
    sending: false,
    threadState: 'idle',
    ...overrides,
  };
}

beforeEach(() => {
  inbox.value = state();
});

describe('MessagesPage', () => {
  it('does not carry a draft into another conversation', async () => {
    const open = (selectedId: number, index: number) =>
      state({
        selectedId,
        selectedConversation: conversations[index],
        threadState: 'ready',
      });
    inbox.value = open(7, 0);
    const { rerender } = render(<MessagesPage />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Reply to customer' }),
      'Meant for Ada'
    );

    inbox.value = open(8, 1);
    rerender(<MessagesPage />);
    expect(
      screen.getByRole('textbox', { name: 'Reply to customer' })
    ).toHaveValue('');
  });

  it('opens another conversation at its latest message, not where the last one was scrolled', () => {
    const open = (selectedId: number, index: number, text: string) =>
      state({
        selectedId,
        selectedConversation: conversations[index],
        threadState: 'ready',
        messages: [message(selectedId * 100, 'customer', text)],
      });
    inbox.value = open(7, 0, 'first chat');
    const { rerender } = render(<MessagesPage />);
    const scroller = screen.getByRole('list', { name: 'Messages' })
      .parentElement as HTMLElement;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 2_000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(scroller);

    inbox.value = open(8, 1, 'second chat');
    rerender(<MessagesPage />);
    expect(screen.getByText('second chat')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /new messages/i })
    ).not.toBeInTheDocument();
  });

  it('shows only the open conversation after switching back and forth', () => {
    const open = (selectedId: number, index: number, text: string) =>
      state({
        selectedId,
        selectedConversation: conversations[index],
        threadState: 'ready',
        messages: [message(selectedId * 100, 'customer', text)],
      });
    inbox.value = open(7, 0, 'first chat');
    const { rerender } = render(<MessagesPage />);
    for (const [id, index, text] of [
      [8, 1, 'second chat'],
      [7, 0, 'first chat'],
      [8, 1, 'second chat'],
    ] as const) {
      inbox.value = open(id, index, text);
      rerender(<MessagesPage />);
    }

    expect(screen.getAllByRole('list', { name: 'Messages' })).toHaveLength(1);
    expect(
      screen.getAllByRole('textbox', { name: 'Reply to customer' })
    ).toHaveLength(1);
    expect(screen.getByText('second chat')).toBeInTheDocument();
    expect(screen.queryByText('first chat')).not.toBeInTheDocument();
  });
});
