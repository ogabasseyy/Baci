import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    merchantSlug: 'ogabassey',
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf-token=; Max-Age=0; path=/';
});

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
      merchantSlug: 'ogabassey',
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
      merchantSlug: 'ogabassey',
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

  it('keeps a private full destination out of chat and sends only the confirmed state for a quote', async () => {
    const handleSend = vi.fn();
    const handleSubmit = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 'quote-session', quotes: { all: [], featured: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'csrf-token=csrf-test-token; path=/';
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      cart: [{ cartItemId: 'line-1', quantity: 1, price: 100, name: 'Phone' }],
      merchantSlug: 'ogabassey',
      subtotal: 100,
      isHydrated: true,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useOgabasseyChat).mockImplementation(() => {
      const [input, setInput] = useState('');
      return {
        isOpen: true,
        setIsOpen: vi.fn(),
        messages: [],
        input,
        setInput,
        isLoading: false,
        proactiveMsg: null,
        setProactiveMsg: vi.fn(),
        messagesEndRef: { current: null },
        handleSend,
        handleSubmit,
        handleAddSantaWishToCart: vi.fn(),
      };
    });

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    await user.click(screen.getByRole('button', { name: 'Get delivery estimate' }));

    const privateComposer = screen.getByRole('textbox', { name: 'Private delivery destination' });
    await user.type(privateComposer, 'No. 12 Example Road, Lagos');
    await user.click(screen.getByRole('button', { name: 'Check destination state' }));

    expect(screen.getByText('Lagos', { selector: 'strong' })).toBeInTheDocument();
    expect(handleSend).not.toHaveBeenCalled();
    expect(handleSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, check estimate' }));

    expect(await screen.findByText(/No store-configured rate matched this state/i)).toBeInTheDocument();
    expect(handleSend).not.toHaveBeenCalled();
    expect(handleSubmit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/delivery-estimate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ state: 'Lagos' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('No. 12 Example Road');
  });

  it('clears private delivery mode when the floating close button is used', async () => {
    const setInput = vi.fn();
    const setIsOpen = vi.fn();
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      cart: [{ cartItemId: 'line-1', quantity: 1, price: 100, name: 'Phone' }],
      merchantSlug: 'ogabassey',
      subtotal: 100,
      isHydrated: true,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true,
      setIsOpen,
      messages: [],
      input: '123 Example Road, Lagos',
      setInput,
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
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    await user.click(screen.getByRole('button', { name: 'Get delivery estimate' }));
    expect(screen.getByRole('region', { name: 'Private delivery estimate' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle chat' }));

    expect(setInput).toHaveBeenCalledWith('');
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('region', { name: 'Private delivery estimate' })).not.toBeInTheDocument();
  });

  it.each([
    ['path routing without resolved slug', { routingMode: 'path', merchant: { country: 'NG', payout_currency: 'NGN', slug: undefined }, expected: false }],
    ['path routing with invalid slug', { routingMode: 'path', merchant: { country: 'NG', payout_currency: 'NGN', slug: 'api' }, expected: false }],
    ['non-NGN payout currency', { routingMode: 'domain', merchant: { country: 'NG', payout_currency: 'USD' }, expected: false }],
    ['valid path routing', { routingMode: 'path', merchant: { country: 'NG', payout_currency: 'NGN' }, expected: true }],
  ])('gates delivery estimates for %s', async (_label, merchantContext) => {
    vi.mocked(useMerchantSafe).mockReturnValue({
      basePath: '/ogabassey',
      routingMode: merchantContext.routingMode as 'path' | 'domain',
      merchant: {
        id: 'merchant-1',
        slug: 'merchant' in merchantContext.merchant ? merchantContext.merchant.slug : 'ogabassey',
        ...merchantContext.merchant,
      },
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      cart: [{ cartItemId: 'line-1', quantity: 1, price: 100, name: 'Phone' }],
      merchantSlug: 'ogabassey',
      subtotal: 100,
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
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    if (merchantContext.expected) {
      expect(screen.getByRole('button', { name: 'Get delivery estimate' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('button', { name: 'Get delivery estimate' })).not.toBeInTheDocument();
    }
  });

  it('closes private delivery and clears input when storefront changes away from the cart merchant', async () => {
    const setInput = vi.fn();
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      cart: [{ cartItemId: 'line-1', quantity: 1, price: 100, name: 'Phone' }],
      subtotal: 100,
      isHydrated: true,
      merchantSlug: 'ogabassey',
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);
    vi.mocked(useMerchantSafe).mockReturnValue({
      basePath: '/ogabassey',
      routingMode: 'path',
      merchant: { id: 'merchant-1', slug: 'ogabassey', country: 'NG', payout_currency: 'NGN' },
    } as unknown as ReturnType<typeof useMerchantSafe>);
    vi.mocked(useOgabasseyChat).mockReturnValue({
      isOpen: true, setIsOpen: vi.fn(), messages: [], input: '', setInput, isLoading: false,
      proactiveMsg: null, setProactiveMsg: vi.fn(), messagesEndRef: { current: null },
      handleSend: vi.fn(), handleSubmit: vi.fn(), handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    const view = render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    await user.click(screen.getByRole('button', { name: 'Get delivery estimate' }));
    expect(screen.getByRole('region', { name: 'Private delivery estimate' })).toBeInTheDocument();

    vi.mocked(useMerchantSafe).mockReturnValue({
      basePath: '/winter-store',
      routingMode: 'path',
      merchant: { id: 'merchant-2', slug: 'winter-store', country: 'NG', payout_currency: 'NGN' },
    } as unknown as ReturnType<typeof useMerchantSafe>);
    view.rerender(<ChatWidget />);

    expect(screen.queryByRole('region', { name: 'Private delivery estimate' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Type your message' })).toBeInTheDocument();
    expect(setInput).toHaveBeenCalledWith('');
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
