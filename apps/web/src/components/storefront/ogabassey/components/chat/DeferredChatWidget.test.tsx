import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(storefront)/storefront-chat-style-loader', () => ({
  StorefrontChatStyleLoader: () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/ogabassey'),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    isCartOpen: false,
  })),
}));

vi.mock('../../providers/v2-theme-context', () => ({
  useV2Theme: vi.fn(() => ({
    theme: 'standard',
  })),
}));

import { useCart } from '@/hooks/cart';
import { DeferredChatWidget } from './DeferredChatWidget';

describe('DeferredChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: false,
    } as ReturnType<typeof useCart>);
  });

  it('renders one editable ask bar without loading the chat runtime', () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: () => <div>Loaded chat runtime</div>,
    });

    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    expect(screen.getByRole('textbox', { name: 'Ask Ekaette' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open AI chat assistant' })).not.toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
    expect(screen.queryByText('Loaded chat runtime')).not.toBeInTheDocument();
  });

  it('loads the chat runtime only after the ask bar is submitted', async () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ({ openOnMount }: { openOnMount?: boolean }) => (
        <div>{openOnMount ? 'Loaded chat runtime open' : 'Loaded chat runtime'}</div>
      ),
    });

    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    await user.type(screen.getByRole('textbox', { name: 'Ask Ekaette' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send question to Ekaette' }));

    expect(loadChatWidget).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Loaded chat runtime open')
    ).toBeInTheDocument();
  });

  it('hands an edited question into the lazily loaded chat once', async () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ({
        openOnMount,
        initialMessage,
      }: {
        openOnMount?: boolean;
        initialMessage?: string;
      }) => (
        <div>
          {openOnMount ? 'Loaded chat runtime open' : 'Loaded chat runtime'}
          {initialMessage ? `: ${initialMessage}` : ''}
        </div>
      ),
    });

    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    const ask = screen.getByRole('textbox', { name: 'Ask Ekaette' });
    await user.type(ask, 'Do you have this phone in stock?');
    await user.click(screen.getByRole('button', { name: 'Send question to Ekaette' }));

    expect(loadChatWidget).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        'Loaded chat runtime open: Do you have this phone in stock?'
      )
    ).toBeInTheDocument();
  });

  it('does not load the chat for a blank question', async () => {
    const loadChatWidget = vi.fn();
    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    await user.click(screen.getByRole('button', { name: 'Send question to Ekaette' }));

    expect(loadChatWidget).not.toHaveBeenCalled();
  });

  it('keeps the draft and offers retry when lazy loading fails', async () => {
    const loadChatWidget = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({
        ChatWidget: ({ initialMessage }: { initialMessage?: string }) => (
          <div>Loaded chat runtime: {initialMessage}</div>
        ),
      });
    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    const ask = screen.getByRole('textbox', { name: 'Ask Ekaette' });
    await user.type(ask, 'Is this in stock?');
    await user.click(screen.getByRole('button', { name: 'Send question to Ekaette' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not open Ekaette. Your question is saved; try again.'
    );
    expect(ask).toHaveValue('Is this in stock?');

    await user.click(screen.getByRole('button', { name: 'Send question to Ekaette' }));

    expect(loadChatWidget).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText('Loaded chat runtime: Is this in stock?')
    ).toBeInTheDocument();
  });

  it('keeps the launcher mounted but hidden while the cart is open', () => {
    vi.mocked(useCart).mockReturnValue({
      isCartOpen: true,
    } as ReturnType<typeof useCart>);

    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: () => <div>Loaded chat runtime</div>,
    });

    const { container } = render(
      <DeferredChatWidget loadChatWidget={loadChatWidget} />
    );
    const anchor = container.querySelector('.ogabassey-chat-anchor');

    expect(anchor).toHaveClass('ogabassey-chat-anchor--hidden');
    expect(anchor).toHaveAttribute('data-mobile-offset', 'default');
    expect(anchor).toHaveAttribute('data-mobile-offset-cart', '6.75rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-default', '1rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-product', '1rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-screen', '1rem');
    expect(screen.getByRole('textbox', { name: 'Ask Ekaette' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open AI chat assistant' })).not.toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
  });
});
