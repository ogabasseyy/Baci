import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/ogabassey'),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: vi.fn(() => ({ basePath: '/ogabassey' })),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({ isCartOpen: false })),
}));

vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: vi.fn(() => ({ theme: 'standard' })),
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

import { ChatWidget } from './ChatWidget';

describe('ChatWidget focus restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('focuses the launcher after deferred keyboard activation', () => {
    render(<ChatWidget openOnMount focusLauncherOnMount />);

    expect(screen.getByRole('button', { name: 'Toggle chat' })).toHaveFocus();
  });

  it('does not steal focus already moved elsewhere while the runtime loads', () => {
    const externalButton = document.createElement('button');
    document.body.append(externalButton);
    externalButton.focus();
    const { unmount } = render(
      <ChatWidget openOnMount focusLauncherOnMount />,
    );

    expect(externalButton).toHaveFocus();
    unmount();
    externalButton.remove();
  });
});
