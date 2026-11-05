import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/ogabassey') }));
vi.mock('@/hooks/merchant', () => ({ useMerchantSafe: vi.fn() }));
vi.mock('@/hooks/cart', () => ({ useCart: vi.fn() }));
vi.mock('../../providers/v2-theme-context', () => ({ useV2Theme: vi.fn() }));
vi.mock('./chat-cart-review', () => ({
  ChatCartReview: ({ onRequestDeliveryQuote }: { onRequestDeliveryQuote?: () => void }) => (
    <section aria-label="Cart review">
      Cart review content
      {onRequestDeliveryQuote ? <button type="button" onClick={onRequestDeliveryQuote}>Get delivery estimate</button> : null}
    </section>
  ),
}));
vi.mock('./use-ogabassey-chat', () => ({ useOgabasseyChat: vi.fn() }));

import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { useV2Theme } from '../../providers/v2-theme-context';
import { ChatWidget } from './ChatWidget';
import { useOgabasseyChat } from './use-ogabassey-chat';

const makeCart = (merchantSlug = 'ogabassey') => ({
  isCartOpen: false,
  cart: [{ cartItemId: 'line-1', quantity: 1, price: 100, name: 'Phone' }],
  subtotal: 100,
  isHydrated: true,
  merchantSlug,
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
});

const makeMerchant = (routingMode = 'domain', country = 'NG', payout_currency = 'NGN', slug = 'ogabassey') => ({
  basePath: '/ogabassey',
  routingMode,
  merchant: { id: 'merchant-1', slug, country, payout_currency },
});

function installStatefulChat(initialInput = '', handlers = { handleSend: vi.fn(), handleSubmit: vi.fn() }) {
  vi.mocked(useOgabasseyChat).mockImplementation(() => {
    const [input, setInput] = useState(initialInput);
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
      handleSend: handlers.handleSend,
      handleSubmit: handlers.handleSubmit,
      handleAddSantaWishToCart: vi.fn(),
    };
  });
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCart).mockReturnValue(makeCart() as unknown as ReturnType<typeof useCart>);
  vi.mocked(useMerchantSafe).mockReturnValue(makeMerchant() as unknown as ReturnType<typeof useMerchantSafe>);
  vi.mocked(useV2Theme).mockReturnValue({ theme: 'standard', setTheme: vi.fn(), toggleTheme: vi.fn() });
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf-token=; Max-Age=0; path=/';
});

describe('ChatWidget private delivery', () => {
  it('keeps a private full destination out of chat and sends only the confirmed state for a quote', async () => {
    const handlers = installStatefulChat();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: 'quote-session', quotes: { all: [], featured: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'csrf-token=csrf-test-token; path=/';

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    await user.click(screen.getByRole('button', { name: 'Get delivery estimate' }));
    await user.type(screen.getByRole('textbox', { name: 'Private delivery destination' }), 'No. 12 Example Road, Lagos');
    await user.click(screen.getByRole('button', { name: 'Check destination state' }));

    expect(screen.getByText('Lagos', { selector: 'strong' })).toBeInTheDocument();
    expect(handlers.handleSend).not.toHaveBeenCalled();
    expect(handlers.handleSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Yes, check estimate' }));
    expect(await screen.findByText(/No store-configured rate matched this state/i)).toBeInTheDocument();
    expect(handlers.handleSend).not.toHaveBeenCalled();
    expect(handlers.handleSubmit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/delivery-estimate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ state: 'Lagos' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('No. 12 Example Road');
  });

  it('clears an active private address when the cart switches to another merchant', async () => {
    const handlers = installStatefulChat();
    const user = userEvent.setup();
    const view = render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    await user.click(screen.getByRole('button', { name: 'Get delivery estimate' }));
    const privateComposer = screen.getByRole('textbox', { name: 'Private delivery destination' });
    await user.type(privateComposer, 'No. 12 Private Road, Lagos');
    expect(privateComposer).toHaveValue('No. 12 Private Road, Lagos');

    vi.mocked(useCart).mockReturnValue(makeCart('another-store') as unknown as ReturnType<typeof useCart>);
    view.rerender(<ChatWidget />);

    expect(screen.queryByRole('region', { name: 'Private delivery estimate' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Type your message' })).toHaveValue('');
    expect(handlers.handleSend).not.toHaveBeenCalled();
    expect(handlers.handleSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText('No. 12 Private Road, Lagos')).not.toBeInTheDocument();
  });

  it('does not enter private delivery mode when the cart belongs to another merchant', async () => {
    vi.mocked(useCart).mockReturnValue(makeCart('another-store') as unknown as ReturnType<typeof useCart>);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    expect(screen.queryByRole('button', { name: 'Get delivery estimate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Private delivery estimate' })).not.toBeInTheDocument();
  });

  it('clears private delivery mode when the floating close button is used', async () => {
    const setInput = vi.fn();
    const setIsOpen = vi.fn();
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
    ['path routing', makeMerchant('path')],
    ['non-NGN payout currency', makeMerchant('domain', 'NG', 'USD')],
    ['a different merchant', makeMerchant('domain', 'NG', 'NGN', 'another-store')],
  ])('hides delivery estimates for %s', async (_label, merchant) => {
    vi.mocked(useMerchantSafe).mockReturnValue(merchant as unknown as ReturnType<typeof useMerchantSafe>);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: 'Cart, 1 item' }));
    expect(screen.queryByRole('button', { name: 'Get delivery estimate' })).not.toBeInTheDocument();
  });
});
