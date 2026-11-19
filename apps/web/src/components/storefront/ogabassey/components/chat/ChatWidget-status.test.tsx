import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ogabassey',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey' }),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({ isCartOpen: false, addToCart: vi.fn() }),
}));
vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: () => ({ theme: 'standard', setTheme: vi.fn() }),
}));
vi.mock('./use-ogabassey-chat', () => ({
  useOgabasseyChat: () => ({
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
  }),
}));

import { ChatWidget } from './ChatWidget';

it('does not claim a provider or online status without a live health check', () => {
  render(<ChatWidget />);
  expect(screen.queryByText('Online')).toBeNull();
  expect(screen.queryByText(/Powered by Google Gemini/)).toBeNull();
  expect(screen.getByText('Shopping assistant')).toBeDefined();
});
