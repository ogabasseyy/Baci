import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { ConversationMeta } from './ConversationMeta';

const chat = (
  overrides: Partial<InboxConversation> = {}
): InboxConversation => ({
  id: 1,
  status: 'open',
  unreadCount: 0,
  customerName: 'Ada',
  lastActivityAt: null,
  lastMessage: null,
  ...overrides,
});

const renderMeta = (conversation: InboxConversation) =>
  render(
    <ConversationMeta colors={LIGHT_COLORS} conversation={conversation} />
  );

describe('ConversationMeta', () => {
  it('renders nothing for a chat with no priority, follow-up, tags or customer', () => {
    const { container } = renderMeta(chat());
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['urgent', 'Urgent'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ] as const)('shows the %s priority', (priority, label) => {
    renderMeta(chat({ priority }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('says a follow-up is due once the chat is back in the open queue', () => {
    renderMeta(chat({ followUp: true, status: 'open' }));
    expect(screen.getByText('Follow up due')).toBeInTheDocument();
  });

  it('names the day and time for a follow-up still waiting', () => {
    renderMeta(
      chat({
        followUp: true,
        status: 'snoozed',
        snoozedUntil: '2099-01-02T09:00:00',
      })
    );
    expect(screen.getByText(/^Follow up /)).toBeInTheDocument();
    expect(screen.queryByText('Follow up due')).toBeNull();
  });

  it('hides the follow-up note on a finished chat', () => {
    renderMeta(chat({ followUp: true, status: 'resolved', tags: ['lead'] }));
    expect(screen.queryByText(/Follow up/)).toBeNull();
    expect(screen.getByText('Lead')).toBeInTheDocument();
  });

  it('shows two tags and counts the rest', () => {
    renderMeta(chat({ tags: ['order-issue', 'payment', 'lead', 'price'] }));
    expect(screen.getByText('Order issue')).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.queryByText('Lead')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
