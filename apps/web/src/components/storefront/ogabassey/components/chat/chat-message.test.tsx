import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageBubble } from './chat-message';
import type { ChatMessage } from './types';

vi.mock('./agent-ui-event-renderer', () => ({
  AgentUiEventRenderer: () => <div>Trusted product cards</div>,
}));

describe('ChatMessageBubble', () => {
  const onAddToCart = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const userMessage: ChatMessage = {
    role: 'user',
    text: 'Hello, I need help!',
  };

  const modelMessage: ChatMessage = {
    role: 'model',
    text: 'How can I assist you today?',
  };

  const messageWithSantaAction: ChatMessage = {
    role: 'model',
    text: 'I found this product for you!',
    santaAction: {
      productName: 'Samsung Galaxy S24',
      price: 450000,
      added: false,
    },
  };

  const messageWithAddedAction: ChatMessage = {
    role: 'model',
    text: 'Your wish was granted!',
    santaAction: {
      productName: 'iPhone 15',
      price: 600000,
      added: true,
    },
  };

  it('renders user message text', () => {
    render(
      <ChatMessageBubble
        message={userMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('Hello, I need help!')).toBeDefined();
  });

  it('renders user message with "You" label', () => {
    render(
      <ChatMessageBubble
        message={userMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('You')).toBeDefined();
  });

  it('renders user message bubble with flex-row-reverse for right alignment', () => {
    const { container } = render(
      <ChatMessageBubble
        message={userMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.className).toContain('flex-row-reverse');
  });

  it('renders AI message with "Ogabassey AI" label when not santa mode', () => {
    render(
      <ChatMessageBubble
        message={modelMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('Ogabassey AI')).toBeDefined();
  });

  it('renders AI message with "Santa AI" label in santa mode', () => {
    render(
      <ChatMessageBubble
        message={modelMessage}
        index={0}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('Santa AI')).toBeDefined();
  });

  it('renders AI message text content', () => {
    render(
      <ChatMessageBubble
        message={modelMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('How can I assist you today?')).toBeDefined();
  });

  it('renders validated UI events only on assistant messages', () => {
    const message: ChatMessage = {
      ...modelMessage,
      uiEvents: [
        {
          intent: 'discover',
          products: [
            {
              brand: null,
              category: null,
              description: null,
              hasVariants: false,
              id: 'product-1',
              imageUrl: null,
              manageStock: false,
              name: 'Phone',
              price: 10_000,
              slug: null,
              stock: null,
            },
          ],
          title: 'Products I found',
          type: 'present_products',
        },
      ],
    };

    const { unmount } = render(
      <ChatMessageBubble
        message={message}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );

    expect(screen.getByText('Trusted product cards')).toBeDefined();

    unmount();
    render(
      <ChatMessageBubble
        message={{ ...message, role: 'user' }}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );

    expect(screen.queryByText('Trusted product cards')).toBeNull();
  });

  it('shows santa action section when message has santaAction', () => {
    render(
      <ChatMessageBubble
        message={messageWithSantaAction}
        index={0}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('Wish Granted!')).toBeDefined();
    expect(screen.getByText('Samsung Galaxy S24')).toBeDefined();
  });

  it('shows Add to Cart button when santaAction is not yet added', () => {
    render(
      <ChatMessageBubble
        message={messageWithSantaAction}
        index={0}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    const button = screen.getByRole('button', { name: /add to cart & checkout/i });
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows "Added to Cart!" text when santaAction.added is true', () => {
    render(
      <ChatMessageBubble
        message={messageWithAddedAction}
        index={1}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.getByText('Added to Cart!')).toBeDefined();
  });

  it('disables the button when santaAction.added is true', () => {
    render(
      <ChatMessageBubble
        message={messageWithAddedAction}
        index={1}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    const button = screen.getByRole('button', { name: /added to cart!/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not show action button for messages without santaAction', () => {
    render(
      <ChatMessageBubble
        message={modelMessage}
        index={0}
        isSanta={false}
        onAddToCart={onAddToCart}
      />
    );
    expect(screen.queryByText('Wish Granted!')).toBeNull();
    expect(screen.queryByRole('button', { name: /add to cart/i })).toBeNull();
  });

  it('calls onAddToCart with the correct message index when button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ChatMessageBubble
        message={messageWithSantaAction}
        index={3}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    const button = screen.getByRole('button', { name: /add to cart & checkout/i });
    await user.click(button);
    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(3, 0);
  });

  it('renders one add-to-cart button per Santa action', async () => {
    const user = userEvent.setup();
    const messageWithSantaActions: ChatMessage = {
      role: 'model',
      text: 'Santa found two gifts',
      santaActions: [
        { productName: 'iPhone 15', price: 600000, added: false },
        { productName: 'Pixel 9', price: 500000, added: false },
      ],
    };

    render(
      <ChatMessageBubble
        message={messageWithSantaActions}
        index={4}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );

    expect(screen.getByText('iPhone 15')).toBeDefined();
    expect(screen.getByText('Pixel 9')).toBeDefined();

    const buttons = screen.getAllByRole('button', {
      name: /add to cart & checkout/i,
    });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[1]);
    expect(onAddToCart).toHaveBeenCalledWith(4, 1);
  });

  it('displays the price in the santa action area', () => {
    render(
      <ChatMessageBubble
        message={messageWithSantaAction}
        index={0}
        isSanta={true}
        onAddToCart={onAddToCart}
      />
    );
    // Price 450000 formatted with toLocaleString
    const container = document.body;
    expect(container.textContent).toContain('450');
  });
});
