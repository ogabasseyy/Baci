import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRouterPush = vi.fn();

// Mock heavy dependencies before any imports
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/ogabassey'),
  useRouter: vi.fn(() => ({ push: mockRouterPush })),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: vi.fn(() => ({ basePath: '/ogabassey' })),
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

import { useOgabasseyChat } from './use-ogabassey-chat';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useCart } from '@/hooks/cart';
import { ChatWidget } from './ChatWidget';

function getChatAnchor(container: HTMLElement) {
  const anchor = container.querySelector('.ogabassey-chat-anchor');
  expect(anchor).not.toBeNull();
  return anchor as HTMLElement;
}

function expectMobileOffsetContract(anchor: HTMLElement) {
  expect(anchor).toHaveAttribute('data-mobile-offset-cart', '6.75rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-default', '5.75rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-product', '6.25rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-screen', '1rem');
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

  it('exposes the mobile offset contract on the widget anchor', () => {
    const { container } = render(<ChatWidget />);
    const anchor = getChatAnchor(container);

    expect(anchor).toHaveAttribute('data-mobile-offset', 'default');
    expectMobileOffsetContract(anchor);
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
    expectMobileOffsetContract(anchor);
    expect(screen.getByRole('button', { name: 'Toggle chat' })).toBeInTheDocument();
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

  it('deep-links to the storefront /repairs page when the repair-quote chip is clicked', async () => {
    const handleSend = vi.fn();
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
      handleSend,
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.click(screen.getByRole('button', { name: 'Repair quote' }));

    expect(mockRouterPush).toHaveBeenCalledWith('/ogabassey/repairs');
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(handleSend).not.toHaveBeenCalled();
  });

  it('sends the label as a chat message for non-navigation chips', async () => {
    const handleSend = vi.fn();
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
      handleSend,
      handleSubmit: vi.fn(),
      handleAddSantaWishToCart: vi.fn(),
    });

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.click(screen.getByRole('button', { name: 'Track my order' }));

    expect(handleSend).toHaveBeenCalledWith('Track my order');
    expect(mockRouterPush).not.toHaveBeenCalled();
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

  it('shows "Online" status text in the header', () => {
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
    expect(screen.getByText('Online')).toBeDefined();
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

    // The dismiss button is inside the proactive bubble (contains an X icon)
    const allButtons = screen.getAllByRole('button');
    // The dismiss button is a small button inside the bubble (not the toggle)
    const dismissButton = allButtons.find(
      (btn) => btn !== screen.getByRole('button', { name: 'Toggle chat' })
    );
    expect(dismissButton).toBeDefined();
    if (dismissButton) {
      await user.click(dismissButton);
    }
    expect(setProactiveMsg).toHaveBeenCalledWith(null);
  });
});
