import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyChat } from './use-ogabassey-chat';

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

  it('does not reopen a closed chat when its theme changes', () => {
    const setIsOpen = vi.fn();
    vi.mocked(useOgabasseyChat).mockImplementation(() => ({
      isOpen: false,
      setIsOpen: (open) => setIsOpen(open),
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
    }));
    const { rerender } = render(<ChatWidget openOnMount />);
    expect(setIsOpen).toHaveBeenCalledWith(true);

    setIsOpen.mockClear();
    vi.mocked(useV2Theme).mockReturnValue({
      theme: 'santa',
      setTheme: vi.fn(),
      toggleTheme: vi.fn(),
    });
    rerender(<ChatWidget openOnMount />);

    expect(setIsOpen).not.toHaveBeenCalled();
  });

  it('restores focus to the launcher when the chat header closes', () => {
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
    render(<ChatWidget />);

    const close = screen.getByRole('button', { name: 'Close chat' });
    close.focus();
    close.click();

    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Toggle chat' })).toHaveFocus();
  });
});
