import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from '@/hooks/cart';
import { useOgabasseyChat } from './use-ogabassey-chat';
import { ChatWidget } from './ChatWidget';

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: vi.fn(() => ({
    id: 'merchant-1',
    business_name: 'Ogabassey',
    business_type: 'electronics',
    currency: 'NGN',
  })),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/ogabassey'),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: vi.fn(() => ({
    theme: 'standard',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  })),
}));

vi.mock('../../scroll-visibility-store', () => ({
  useOgabasseyScrollVisibility: vi.fn(() => true),
}));

vi.mock('./use-ogabassey-chat', () => ({
  useOgabasseyChat: vi.fn(),
}));

function getChatAnchor(container: HTMLElement) {
  const anchor = container.querySelector('.ogabassey-chat-anchor');
  if (!(anchor instanceof HTMLElement)) {
    throw new Error('Expected .ogabassey-chat-anchor to be rendered');
  }
  return anchor;
}

function expectMobileOffsetContract(anchor: HTMLElement) {
  expect(anchor).toHaveAttribute('data-mobile-offset-cart', '6.75rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-default', '1rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-product', '1rem');
  expect(anchor).toHaveAttribute('data-mobile-offset-screen', '1rem');
}

describe('ChatWidget - Mobile Offset Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
      addToCart: vi.fn(),
      setIsCartOpen: vi.fn(),
    } as unknown as ReturnType<typeof useCart>);

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
    } as unknown as ReturnType<typeof useOgabasseyChat>);
  });

  it('exposes the post-bottom-nav 1rem mobile offset contract on the widget anchor', () => {
    const { container } = render(<ChatWidget />);
    const anchor = getChatAnchor(container);

    expect(anchor).toHaveAttribute('data-mobile-offset', 'default');
    expectMobileOffsetContract(anchor);
  });

  it('preserves the 1rem mobile offset contract when cart is open in hidden state', () => {
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
  });
});
