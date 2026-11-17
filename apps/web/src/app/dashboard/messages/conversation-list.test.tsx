import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { ConversationList } from './conversation-list';

function conversation(
  id: number,
  overrides: Partial<MerchantInboxConversation> = {}
): MerchantInboxConversation {
  return {
    id,
    status: 'open',
    unreadCount: 0,
    customerName: `Customer ${id}`,
    lastActivityAt: null,
    lastMessage: {
      id: id * 10,
      sender: 'customer',
      kind: 'text',
      text: `hello from ${id}`,
      createdAt: '2026-11-15T06:00:00.000Z',
    },
    ...overrides,
  };
}

describe('ConversationList', () => {
  it('explains an empty inbox', () => {
    render(
      <ConversationList
        conversations={[]}
        onSelect={vi.fn()}
        selectedId={null}
      />
    );
    expect(screen.getByText(/No customer conversations yet/)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows each customer with a preview and an unread count', () => {
    render(
      <ConversationList
        conversations={[conversation(7, { unreadCount: 3 }), conversation(8)]}
        onSelect={vi.fn()}
        selectedId={null}
      />
    );
    expect(screen.getByText('Customer 7')).toBeTruthy();
    expect(screen.getByText('hello from 8')).toBeTruthy();
    expect(screen.getByLabelText('3 unread')).toBeTruthy();
    expect(screen.queryByLabelText('0 unread')).toBeNull();
  });

  it('marks the selected conversation and reports clicks', async () => {
    const onSelect = vi.fn();
    render(
      <ConversationList
        conversations={[conversation(7), conversation(8)]}
        onSelect={onSelect}
        selectedId={8}
      />
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[1].getAttribute('aria-current')).toBe('true');

    await userEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it('shows a dash when a conversation has no message yet', () => {
    render(
      <ConversationList
        conversations={[conversation(7, { lastMessage: null })]}
        onSelect={vi.fn()}
        selectedId={null}
      />
    );
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('labels an empty attachment message instead of leaving it blank', () => {
    render(
      <ConversationList
        conversations={[
          conversation(7, {
            lastMessage: {
              id: 1,
              sender: 'customer',
              kind: 'other',
              text: '',
              createdAt: '2026-11-15T06:00:00.000Z',
            },
          }),
        ]}
        onSelect={vi.fn()}
        selectedId={null}
      />
    );
    expect(screen.getByText('Attachment or unsupported message')).toBeTruthy();
  });
});
