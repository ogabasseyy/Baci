import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy dependencies before any imports
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/ogabassey'),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: vi.fn(() => ({
    basePath: '/ogabassey',
    routingMode: 'domain',
    merchant: { id: 'merchant-1', slug: 'ogabassey', country: 'NG', payout_currency: 'NGN' },
  })),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    isCartOpen: false,
    addToCart: vi.fn(),
    setIsCartOpen: vi.fn(),
  })),
}));

vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: vi.fn(() => ({
    theme: 'standard',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  })),
}));

vi.mock('./chat-cart-review', () => ({
  ChatCartReview: ({ onRequestDeliveryQuote }: { onRequestDeliveryQuote?: () => void }) => (
    <section aria-label="Cart review">
      Cart review content
      {onRequestDeliveryQuote ? (
        <button type="button" onClick={onRequestDeliveryQuote}>Get delivery estimate</button>
      ) : null}
    </section>
  ),
}));


vi.mock('./chat-delivery-quote', () => ({
  ChatDeliveryQuote: () => <section aria-label="Private destination entry">Private destination</section>,
}));

vi.mock('./use-ogabassey-chat', () => ({
  useOgabasseyChat: vi.fn(() => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    messages: [],
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    proactiveMsg: null,
    setProactiveMsg: vi.fn(),
    messagesEndRef: { current: null },
    handleSend: vi.fn(),
    handleSubmit: vi.fn(),
    handleAddSantaWishToCart: vi.fn(),
  })),
}));

import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { useV2Theme } from '../../providers/v2-theme-context';
import { ChatWidget } from './ChatWidget';
import { useOgabasseyChat } from './use-ogabassey-chat';


function getChatAnchor(container: HTMLElement) {
  const anchor = container.querySelector('.ogabassey-chat-anchor');
  expect(anchor).not.toBeNull();
  return anchor as HTMLElement;
}

describe('ChatWidget - toggle button', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to default mock values
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      basePath: '/ogabassey',
      routingMode: 'domain',
      merchant: { id: 'merchant-1', slug: 'ogabassey', country: 'NG', payout_currency: 'NGN' },
    } as unknown as ReturnType<typeof useMerchantSafe>);

    vi.mocked(useV2Theme).mockReturnValue({
      theme: 'standard',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    });

    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });
  });

  it('renders the toggle button with aria-label "Toggle chat"', () => {
    render(<ChatWidget />);
    const button = screen.getByRole('button', { name: 'Toggle chat' });
    expect(button).toBeDefined();
  });

  it('renders the AI badge on the toggle button', () => {
    render(<ChatWidget />);
    expect(screen.getByText('AI')).toBeDefined();
  });

  it('does not render chat window when isOpen is false', () => {
    render(<ChatWidget />);
    expect(screen.queryByText('Ogabassey AI')).toBeNull();
  });

  it('calls setIsOpen when toggle button is clicked', async () => {
    const setIsOpen = vi.fn();
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen,
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);
    const button = screen.getByRole('button', { name: 'Toggle chat' });
    await user.click(button);
    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it('opens immediately when mounted with openOnMount', async () => {
    const setIsOpen = vi.fn();
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen,
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget openOnMount />);

    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it('keeps the widget mounted but hidden when cart is open', () => {
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: true,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);

    const { container } = render(<ChatWidget />);
    const anchor = getChatAnchor(container);

    expect(anchor).toHaveClass('ogabassey-chat-anchor--hidden');
    expect(anchor).toHaveAttribute('data-mobile-offset', 'default');
    expect(
      screen.getByRole('button', { name: 'Toggle chat' })
    ).toBeInTheDocument();
  });
});

describe('ChatWidget - chat window when open', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);

    vi.mocked(useV2Theme).mockReturnValue({
      theme: 'standard',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    });
  });

  it('keeps the assistant header and greeting while cart review toggles inside the conversation', async () => {
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      cart: [{ cartItemId: 'line-1', quantity: 2, price: 100, name: 'Phone' }],
      subtotal: 200,
      isHydrated: true,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);

    expect(screen.getByText('Ogabassey AI')).toBeInTheDocument();
    expect(screen.getByText('Shopping assistant')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cart review' })).not.toBeInTheDocument();
    const cartButton = screen.getByRole('button', { name: 'Cart, 2 items' });
    expect(cartButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(cartButton);

    expect(cartButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Cart review' })).toBeInTheDocument();
  });

  it('renders "Ogabassey AI" header when chat is open in standard mode', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    expect(screen.getByText('Ogabassey AI')).toBeDefined();
  });

  it('renders close button inside chat window', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    const closeBtn = screen.getByRole('button', { name: 'Close chat' });
    expect(closeBtn).toBeDefined();
  });

  it('calls setIsOpen(false) when close button is clicked', async () => {
    const setIsOpen = vi.fn();
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen,
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);
    const closeBtn = screen.getByRole('button', { name: 'Close chat' });
    await user.click(closeBtn);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it('renders messages from the hook', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [
        { role: 'model', text: 'Hello! How can I help you today?' },
        { role: 'user', text: 'I need a new phone.' },
      ],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    expect(screen.getByText('Hello! How can I help you today?')).toBeDefined();
    expect(screen.getByText('I need a new phone.')).toBeDefined();
  });

  it('shows loading indicator when isLoading is true', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: true,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const { container } = render(<ChatWidget />);
    // Loading dots are rendered as span elements with animate-bounce class
    const bouncingDots = container.querySelectorAll('.animate-bounce');
    expect(bouncingDots.length).toBeGreaterThan(0);
  });

  it('renders "Santa AI" header in santa theme mode', () => {
    vi.mocked(useV2Theme).mockReturnValue({
      theme: 'santa',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    });

    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    expect(screen.getByText(/Santa AI/)).toBeDefined();
    const avatar = screen.getByRole('img', { name: 'Santa' });
    expect(avatar).toHaveAttribute('width', '36');
    expect(avatar).toHaveAttribute('height', '36');
  });
});

describe('ChatWidget - proactive nudge bubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);

    vi.mocked(useV2Theme).mockReturnValue({
      theme: 'standard',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    });
  });

  it('renders proactive message bubble when proactiveMsg is set and chat is closed', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: 'Looking for a new phone?',
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    expect(screen.getByText('Looking for a new phone?')).toBeDefined();
  });

  it('does not render proactive bubble when proactiveMsg is null', () => {
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: null,
      setProactiveMsg: vi.fn(),
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    render(<ChatWidget />);
    expect(screen.queryByText('Looking for a new phone?')).toBeNull();
  });

  it('calls setProactiveMsg(null) when the dismiss button on the nudge bubble is clicked', async () => {
    const setProactiveMsg = vi.fn();
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: false,
      setIsOpen: vi.fn(),
      messages: [],
      input: '',
      setInput: vi.fn(),
      isLoading: false,
      proactiveMsg: 'Check out our deals!',
      setProactiveMsg,
      messagesEndRef: { current: null },
      handleSend: vi.fn(),
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.click(
      screen.getByRole('button', { name: 'Dismiss chat suggestion' })
    );
    expect(setProactiveMsg).toHaveBeenCalledWith(null);
  });
});
