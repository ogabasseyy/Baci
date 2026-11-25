import { describe, expect, it } from 'vitest';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { conversationA11yLabel } from './conversationA11yLabel';

const chat = (
  overrides: Partial<InboxConversation> = {}
): InboxConversation => ({
  id: 7,
  status: 'open',
  unreadCount: 0,
  customerName: 'Ada Test',
  lastActivityAt: '2026-11-22T10:00:00Z',
  lastMessage: null,
  ...overrides,
});

const spoken = (
  conversation: InboxConversation,
  preview = 'Is it in stock?',
  waiting = false
) => conversationA11yLabel(conversation, { preview, waiting });

describe('conversationA11yLabel', () => {
  it('names the shopper and reads the preview', () => {
    expect(spoken(chat())).toBe('Conversation with Ada Test. Is it in stock?');
  });

  it('says when a reply is needed and how many messages are new', () => {
    expect(spoken(chat({ unreadCount: 2 }), 'Hi', true)).toBe(
      'Conversation with Ada Test, needs reply, 2 new. Hi'
    );
  });

  it('bugfix: reads out the priority, the follow-up and every tag, not only the name', () => {
    const label = spoken(
      chat({
        priority: 'urgent',
        followUp: true,
        status: 'snoozed',
        snoozedUntil: null,
        // Five tags: the row shows two, a screen reader hears all of them.
        tags: ['payment', 'order-issue', 'lead', 'price', 'delivery'],
      })
    );

    expect(label).toContain('Urgent priority');
    expect(label).toContain('Follow up');
    expect(label).toContain('tags Payment, Order issue, Lead, Price, Delivery');
  });

  it('reads a search snippet passed in as the preview', () => {
    expect(spoken(chat(), 'where is my order 1234')).toMatch(
      /where is my order 1234$/
    );
  });

  it('leaves out a follow-up on a chat that is already Done', () => {
    expect(spoken(chat({ followUp: true, status: 'resolved' }))).toBe(
      'Conversation with Ada Test. Is it in stock?'
    );
  });
});
