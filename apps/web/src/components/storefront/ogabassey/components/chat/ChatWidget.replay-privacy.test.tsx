import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ogabassey',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/cart', () => ({ useCart: () => ({ isCartOpen: false }) }));
vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey' }),
}));
vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: () => ({ theme: 'standard' }),
}));
vi.mock('../../scroll-visibility-store', () => ({
  useOgabasseyScrollVisibility: () => false,
}));
vi.mock('./use-ogabassey-chat', () => ({
  useOgabasseyChat: () => ({
    isOpen: true,
    setIsOpen: vi.fn(),
    messages: [{ role: 'user', text: 'My order number is 12345.' }],
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

describe('ChatWidget replay privacy', () => {
  it('places the transcript and input inside the replay-blocked panel', () => {
    const { container } = render(<ChatWidget />);
    const message = screen.getByText('My order number is 12345.');
    const input = screen.getByRole('textbox', { name: 'Type your message' });
    const replayBlock = container.querySelector('[data-session-replay-block]');

    expect(replayBlock).not.toBeNull();
    expect(replayBlock).toContainElement(message);
    expect(replayBlock).toContainElement(input);
  });
});
