import { fireEvent, render, screen } from '@testing-library/react';
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

  it('renders the launcher immediately without loading the chat runtime', () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: () => <div>Loaded chat runtime</div>,
    });

    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' }),
    ).toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
    expect(screen.queryByText('Loaded chat runtime')).not.toBeInTheDocument();
  });

  it('moves the icon without opening chat after a drag', async () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ({
        initialLauncherPosition,
      }: {
        initialLauncherPosition?: { x: number; y: number };
      }) => (
        <div>
          Saved position: {initialLauncherPosition?.x},
          {initialLauncherPosition?.y}
        </div>
      ),
    });
    const { container } = render(
      <DeferredChatWidget loadChatWidget={loadChatWidget} />,
    );
    const button = screen.getByRole('button', {
      name: 'Open AI chat assistant',
    });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 300,
      width: 56,
      height: 56,
      right: 256,
      bottom: 356,
      x: 200,
      y: 300,
      toJSON: () => ({}),
    });
    const pointer = (type: string, x: number, y: number) =>
      fireEvent(
        button,
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    pointer('pointerdown', 220, 320);
    pointer('pointermove', 120, 220);
    pointer('pointerup', 120, 220);
    fireEvent.click(button, { detail: 1, clientX: 120, clientY: 220 });
    expect(container.querySelector('.ogabassey-chat-anchor')).toHaveStyle({
      transform: 'translate3d(100px, 200px, 0)',
    });
    expect(loadChatWidget).not.toHaveBeenCalled();
    pointer('pointerdown', 120, 220);
    pointer('pointerup', 120, 220);
    fireEvent.click(button, { detail: 1, clientX: 120, clientY: 220 });
    expect(
      await screen.findByText('Saved position: 100,200'),
    ).toBeInTheDocument();
  });

  it('loads the chat runtime only after the launcher is clicked', async () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ({ openOnMount }: { openOnMount?: boolean }) => (
        <div>
          {openOnMount ? 'Loaded chat runtime open' : 'Loaded chat runtime'}
        </div>
      ),
    });

    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    await user.click(
      screen.getByRole('button', { name: 'Open AI chat assistant' }),
    );

    expect(loadChatWidget).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Loaded chat runtime open'),
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
      <DeferredChatWidget loadChatWidget={loadChatWidget} />,
    );
    const anchor = container.querySelector('.ogabassey-chat-anchor');

    expect(anchor).toHaveClass('ogabassey-chat-anchor--hidden');
    expect(anchor).toHaveAttribute('data-mobile-offset', 'default');
    expect(anchor).toHaveAttribute('data-mobile-offset-cart', '6.75rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-default', '5.75rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-product', '6.25rem');
    expect(anchor).toHaveAttribute('data-mobile-offset-screen', '1rem');
    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' }),
    ).toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
  });
});
