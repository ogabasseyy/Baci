import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { inboxAvatar } from '@/lib/merchant-inbox-avatar';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { ConversationListItem, needsReply } from './ConversationListItem';

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

describe('ConversationListItem', () => {
  it('shows the friendly name, a face, the preview and the unread count, and opens the chat', () => {
    const { onPress } = renderItem(chat({ unreadCount: 2 }));

    expect(screen.getByText('Small Meadow')).toBeInTheDocument();
    expect(
      screen.getByText(inboxAvatar('small-meadow-890').emoji)
    ).toBeInTheDocument();
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/new · needs reply/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Small Meadow/ }));
    expect(onPress).toHaveBeenCalledWith(7);
  });

  it('caps a long unread count at 99+', () => {
    renderItem(chat({ unreadCount: 140 }));
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows a real customer name as it is', () => {
    renderItem(chat({ customerName: 'Ada Obi' }));
    expect(screen.getByText('Ada Obi')).toBeInTheDocument();
  });

  it('shows no unread count for a chat that is read', () => {
    renderItem(chat({ unreadCount: 0, lastMessage: message('store') }));
    expect(screen.queryByText('0')).toBeNull();
  });

  it('says in its accessible name when a reply is needed', () => {
    renderItem(chat());
    expect(
      screen.getByRole('button', {
        name: 'Conversation with Small Meadow, needs reply. Hello there',
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

  it('bugfix: shows only Signed in, never counts, when order data is hidden from this user', () => {
    renderItem(
      chat({ customer: { orderCount: 0, totalSpent: 0, ordersHidden: true } })
    );
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText(/Returning/)).toBeNull();
  });

  it('says a reply is needed in the accessible name even when the chat is read', () => {
    renderItem(chat({ unreadCount: 0 }));
    expect(
      screen.getByRole('button', { name: /needs reply/ })
    ).toBeInTheDocument();
  });

  it('keeps amber for a shopper who has waited more than a day', () => {
    renderItem(chat({ lastActivityAt: '2020-01-01T10:00:00Z' }));
    expect(screen.getByText(/2020|Jan/)).toHaveStyle({
      color: LIGHT_COLORS.gold,
    });
  });

  it('does not use amber for a shopper who only just wrote', () => {
    const now = new Date().toISOString();
    renderItem(
      chat({
        lastActivityAt: now,
        lastMessage: { ...message('customer'), createdAt: now },
      })
    );
    expect(screen.getByText('Just now')).not.toHaveStyle({
      color: LIGHT_COLORS.gold,
    });
  });

  it('bugfix: stays amber when someone touches a chat that has waited long', () => {
    // Labels, priority or assignment move the activity time, not the wait.
    renderItem(
      chat({
        lastActivityAt: new Date().toISOString(),
        lastMessage: {
          ...message('customer'),
          createdAt: '2020-01-01T10:00:00Z',
        },
      })
    );
    expect(screen.getByText('Just now')).toHaveStyle({
      color: LIGHT_COLORS.gold,
    });
  });
});
