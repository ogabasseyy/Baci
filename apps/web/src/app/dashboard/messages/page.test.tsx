import { fireEvent, render, screen, within } from '@testing-library/react';
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
  it.each([
    ['loading', 'status', /loading your messages/i],
    ['not_set_up', 'alert', /not set up for this store/i],
    ['forbidden', 'alert', /do not have permission/i],
    ['signed_out', 'alert', /sign in again/i],
    ['unavailable', 'alert', /temporarily unavailable/i],
  ])('explains the %s state', (listState, role, text) => {
    inbox.value = state({ listState, conversations: [] });
    render(<MessagesPage />);
    expect(screen.getByRole(role)).toHaveTextContent(text);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('insights-card')).not.toBeInTheDocument();
  });

  it('shows the insights card once the inbox is ready', () => {
    render(<MessagesPage />);
    expect(screen.getByTestId('insights-card')).toBeInTheDocument();
  });

  it('lists conversations with previews and unread counts', async () => {
    render(<MessagesPage />);
    const list = screen.getByRole('list', { name: 'Customer conversations' });
    const first = within(list).getByRole('button', { name: /Ada Synthetic/ });
    expect(first).toHaveTextContent('Do you have the Demo Phone X?');
    expect(within(first).getByLabelText('2 unread')).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: /Bola Synthetic/ })
    ).toHaveTextContent('You: Yes, we deliver.');
    expect(
      screen.getByText('Select a conversation to read and reply.')
    ).toBeInTheDocument();

    await userEvent.click(first);
    expect(inbox.value.selectConversation).toHaveBeenCalledWith(7);
  });

  it('says so when older conversations are not listed', () => {
    render(<MessagesPage />);
    expect(screen.queryByText(/most recent conversations/i)).toBeNull();
    inbox.value = state({ hasMoreConversations: true });
    render(<MessagesPage />);
    expect(screen.getByText(/most recent conversations/i)).toBeInTheDocument();
  });

  it('shows an empty inbox message', () => {
    inbox.value = state({ conversations: [] });
    render(<MessagesPage />);
    expect(
      screen.getByText(/No customer conversations yet/)
    ).toBeInTheDocument();
  });

  it('shows the selected thread with who said what', () => {
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState: 'ready',
      messages: [
        message(30, 'customer', 'Do you have the Demo Phone X?'),
        message(
          31,
          'assistant',
          'Here it is:\nSynthetic Demo Phone X',
          'product_card'
        ),
        message(32, 'store', 'We can deliver today.'),
      ],
    });
    render(<MessagesPage />);

    expect(
      screen.getByRole('heading', { name: 'Ada Synthetic' })
    ).toBeInTheDocument();
    const items = within(
      screen.getByRole('list', { name: 'Messages' })
    ).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Customer');
    expect(items[1]).toHaveTextContent('Assistant · Product card');
    expect(items[1]).toHaveTextContent('Synthetic Demo Phone X');
    expect(items[2]).toHaveTextContent('You');
    expect(
      screen.getByRole('button', { name: 'Back to conversations' })
    ).toBeInTheDocument();
  });

  it.each([
    ['loading', 'status', /loading conversation/i],
    ['error', 'alert', /could not be loaded/i],
  ])('explains a %s thread', (threadState, role, text) => {
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState,
    });
    render(<MessagesPage />);
    expect(screen.getByRole(role)).toHaveTextContent(text);
  });

  it('sends a reply and clears the box only when accepted', async () => {
    const sendReply = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState: 'ready',
      sendReply,
    });
    render(<MessagesPage />);
    const box = screen.getByRole('textbox', { name: 'Reply to customer' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    await userEvent.type(box, 'We can deliver today.');
    await userEvent.click(send);
    expect(sendReply).toHaveBeenCalledWith('We can deliver today.');
    expect(box).toHaveValue('We can deliver today.');

    await userEvent.type(box, '{Enter}');
    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
  });

  it.each([
    ['unauthorized', /sign in again to reply/i],
    ['forbidden', /do not have permission to reply/i],
  ])('explains a %s reply failure', (sendError, text) => {
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState: 'ready',
      sendError,
    });
    render(<MessagesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('warns before a resend when delivery is unknown', () => {
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState: 'ready',
      sendError: 'delivery_unknown',
    });
    render(<MessagesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not confirm this reply was sent/i
    );
  });

  it('locks the reply box and Send while a reply is in flight', async () => {
    inbox.value = state({
      selectedId: 7,
      selectedConversation: conversations[0],
      threadState: 'ready',
      sending: true,
    });
    render(<MessagesPage />);
    const box = screen.getByRole('textbox', { name: 'Reply to customer' });
    await userEvent.type(box, 'typed during send');
    expect(box).toHaveValue('');
    expect(box).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  });

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

  it('shortens a long preview in the content itself', () => {
    inbox.value = state({
      conversations: [
        {
          ...conversations[0],
          lastMessage: message(30, 'customer', `${'long '.repeat(400)}end`),
        },
      ],
    });
    render(<MessagesPage />);
    const button = screen.getByRole('button', { name: /Ada Synthetic/ });
    expect(button.textContent?.length).toBeLessThan(220);
    expect(button).toHaveTextContent('…');
  });
});
