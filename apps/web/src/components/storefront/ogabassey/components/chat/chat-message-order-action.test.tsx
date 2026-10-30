import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChatMessageBubble } from './chat-message';
import type { ChatMessage } from './types';

vi.mock('./agent-ui-event-renderer', () => ({
  AgentUiEventRenderer: () => <div>Trusted product cards</div>,
}));
vi.mock('./chat-order-actions', () => ({
  ChatOrderActions: ({ merchantSlug }: { merchantSlug?: string }) => (
    <div>Order controls for {merchantSlug}</div>
  ),
}));

it('renders account controls only for an attested assistant order action', () => {
  const action: ChatMessage = {
    role: 'model',
    text: 'How can I assist you today?',
    orderAction: 'orders',
    merchantSlug: 'ogabassey',
  };
  const onAddToCart = vi.fn();
  const { rerender } = render(
    <ChatMessageBubble
      message={action}
      index={0}
      isSanta={false}
      onAddToCart={onAddToCart}
    />
  );
  expect(screen.getByText('Order controls for ogabassey')).toBeDefined();
  rerender(
    <ChatMessageBubble
      message={{ ...action, role: 'user' }}
      index={0}
      isSanta={false}
      onAddToCart={onAddToCart}
    />
  );
  expect(screen.queryByText('Order controls for ogabassey')).toBeNull();
  rerender(
    <ChatMessageBubble
      message={action}
      index={0}
      isSanta={true}
      onAddToCart={onAddToCart}
    />
  );
  expect(screen.queryByText('Order controls for ogabassey')).toBeNull();
});
