import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import {
  badgeText,
  ConversationListItem,
  needsReply,
} from './ConversationListItem';

const message = (
  sender: 'customer' | 'store' | 'assistant' | 'system',
  text = 'Hello there'
) => ({
  id: 10,
  sender,
  kind: 'text' as const,
  text,
  createdAt: '2026-11-22T10:00:00Z',
});

const chat = (
  overrides: Partial<InboxConversation> = {}
): InboxConversation => ({
  id: 7,
  status: 'open',
  unreadCount: 0,
  customerName: 'small-meadow-890',
  lastActivityAt: '2026-11-22T10:00:00Z',
  lastMessage: message('customer'),
  ...overrides,
});

function renderItem(conversation: InboxConversation, snippet?: string | null) {
  const onPress = vi.fn();
  render(
    <ConversationListItem
      colors={LIGHT_COLORS}
      conversation={conversation}
      onPress={onPress}
      snippet={snippet}
    />
  );
  return { onPress };
}

describe('needsReply', () => {
  it.each([
    ['open', true],
    ['pending', true],
    ['resolved', false],
    ['snoozed', false],
  ] as const)('is %s -> %s when the shopper wrote last', (status, expected) => {
    expect(needsReply(chat({ status }))).toBe(expected);
  });

  it('is false when the store, the assistant or the system spoke last', () => {
    for (const sender of ['store', 'assistant', 'system'] as const) {
      expect(needsReply(chat({ lastMessage: message(sender) }))).toBe(false);
    }
  });

  it('is false for a chat with no messages', () => {
    expect(needsReply(chat({ lastMessage: null }))).toBe(false);
  });
});

describe('badgeText', () => {
  it('combines the unread count with needs reply', () => {
    expect(badgeText(chat({ unreadCount: 3 }))).toBe('3 new · needs reply');
  });

  it('shows only the count when the store answered last', () => {
    expect(
      badgeText(chat({ unreadCount: 2, lastMessage: message('store') }))
    ).toBe('2 new');
  });

  it('shows Needs reply with no unread count, and nothing when all is quiet', () => {
    expect(badgeText(chat())).toBe('Needs reply');
    expect(badgeText(chat({ lastMessage: message('store') }))).toBeNull();
  });

  it('shows nothing about replying for a resolved chat, only its unread count', () => {
    expect(badgeText(chat({ status: 'resolved', unreadCount: 1 }))).toBe(
      '1 new'
    );
    expect(badgeText(chat({ status: 'resolved' }))).toBeNull();
  });
});

describe('ConversationListItem', () => {
  it('shows the name, initials, preview and badge, and opens the chat', () => {
    const { onPress } = renderItem(chat({ unreadCount: 2 }));

    expect(screen.getByText('small-meadow-890')).toBeInTheDocument();
    expect(screen.getByText('SM')).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('2 new · needs reply')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /small-meadow-890/ }));
    expect(onPress).toHaveBeenCalledWith(7);
  });

  it('says in its accessible name when a reply is needed', () => {
    renderItem(chat());
    expect(
      screen.getByRole('button', {
        name: 'Conversation with small-meadow-890, needs reply',
      })
    ).toBeInTheDocument();
    expect(needsReply(chat({ status: 'resolved' }))).toBe(false);
  });

  it('prefixes what the store and the assistant said', () => {
    renderItem(chat({ lastMessage: message('store', 'On its way') }));
    expect(screen.getByText('You: On its way')).toBeInTheDocument();
  });

  it('shows the assistant prefix', () => {
    renderItem(chat({ lastMessage: message('assistant', 'Checking stock') }));
    expect(screen.getByText('Assistant: Checking stock')).toBeInTheDocument();
  });

  it('describes an attachment-only message instead of leaving the preview empty', () => {
    renderItem(
      chat({ lastMessage: { ...message('customer', ''), kind: 'other' } })
    );
    expect(screen.getByText('Attachment')).toBeInTheDocument();
  });

  it('says so when a chat has no messages yet', () => {
    renderItem(chat({ lastMessage: null }));
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('shows the matching words from a search instead of the last message', () => {
    renderItem(chat(), 'where is my order 1234');
    expect(screen.getByText('where is my order 1234')).toBeInTheDocument();
    expect(screen.queryByText('Hello there')).toBeNull();
  });

  it('falls back to the last message when a search hit has no snippet', () => {
    renderItem(chat(), null);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('shows priority, follow-up and tags under the preview', () => {
    renderItem(
      chat({
        priority: 'urgent',
        followUp: true,
        status: 'open',
        tags: ['order-issue'],
      })
    );
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('Follow up due')).toBeInTheDocument();
    expect(screen.getByText('Order issue')).toBeInTheDocument();
  });

  it('marks a returning customer with their order count', () => {
    renderItem(chat({ customer: { orderCount: 3, totalSpent: 150000 } }));
    expect(screen.getByText('Returning · 3 orders')).toBeInTheDocument();
  });

  it('says one order in the singular, and Signed in for a customer with none yet', () => {
    const { unmount } = render(
      <ConversationListItem
        colors={LIGHT_COLORS}
        conversation={chat({ customer: { orderCount: 1, totalSpent: 100 } })}
        onPress={vi.fn()}
      />
    );
    expect(screen.getByText('Returning · 1 order')).toBeInTheDocument();
    unmount();

    renderItem(chat({ customer: { orderCount: 0, totalSpent: 0 } }));
    expect(screen.getByText('Signed in')).toBeInTheDocument();
  });

  it('shows no customer pill for a guest', () => {
    renderItem(chat({ customer: null }));
    expect(screen.queryByText(/Returning|Signed in/)).toBeNull();
  });
});
