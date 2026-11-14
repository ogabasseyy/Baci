// @vitest-environment-options {"url":"https://shop.example.com"}
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
import { ChatwootWidget } from '@/components/storefront/chatwoot-widget';
import { DeferredChatWidget } from './DeferredChatWidget';

describe('DeferredChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { chatwootSDK?: unknown }).chatwootSDK;
    delete (window as Window & { $chatwoot?: unknown }).$chatwoot;
    delete (window as Window & { __baciChatwootRunStarted?: boolean })
      .__baciChatwootRunStarted;
    delete (window as Window & { __baciChatwootConfigKey?: string })
      .__baciChatwootConfigKey;
    delete (window as Window & { __baciChatwootReadyKey?: string })
      .__baciChatwootReadyKey;
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
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    ).toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
    expect(screen.queryByText('Loaded chat runtime')).not.toBeInTheDocument();
  });

  it('loads the chat runtime only after the launcher is clicked', async () => {
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ({ openOnMount }: { openOnMount?: boolean }) => (
        <div>{openOnMount ? 'Loaded chat runtime open' : 'Loaded chat runtime'}</div>
      ),
    });

    const user = userEvent.setup();
    render(<DeferredChatWidget loadChatWidget={loadChatWidget} />);

    await user.click(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    );

    expect(loadChatWidget).toHaveBeenCalledOnce();
    expect(
      await screen.findByText('Loaded chat runtime open')
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
    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    ).toBeInTheDocument();
    expect(loadChatWidget).not.toHaveBeenCalled();
  });

  it('suppresses the AI launcher only after the configured Chatwoot widget starts', () => {
    (window as Window & {
      chatwootSDK?: {
        run: (options: { websiteToken: string; baseUrl: string }) => void;
      };
    }).chatwootSDK = {
      run: vi.fn(({ websiteToken, baseUrl }) => {
        (window as Window & {
          $chatwoot?: { websiteToken: string; baseUrl: string };
        }).$chatwoot = { websiteToken, baseUrl };
      }),
    };
    render(
      <ChatwootWidget
        config={{
          platformOrigin: 'https://support.example.com',
          storefrontOrigin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-123456',
          storeSlug: 'shop',
        }}
      >
        <DeferredChatWidget />
      </ChatwootWidget>
    );

    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    ).toBeInTheDocument();
    const script = document.getElementById('baci-chatwoot-sdk');
    expect(script).not.toBeNull();
    script?.dispatchEvent(new Event('load'));
    expect(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    ).toBeInTheDocument();
    fireEvent(window, new Event('chatwoot:ready'));

    expect(
      screen.queryByRole('button', { name: 'Open AI chat assistant' })
    ).not.toBeInTheDocument();
  });

  it('preserves an activated AI chat runtime while Chatwoot is the visible chat', async () => {
    (window as Window & {
      chatwootSDK?: {
        run: (options: { websiteToken: string; baseUrl: string }) => void;
      };
    }).chatwootSDK = {
      run: vi.fn(({ websiteToken, baseUrl }) => {
        (window as Window & {
          $chatwoot?: { websiteToken: string; baseUrl: string };
        }).$chatwoot = { websiteToken, baseUrl };
      }),
    };
    const ChatRuntime = () => {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          AI {count}
        </button>
      );
    };
    const loadChatWidget = vi.fn().mockResolvedValue({
      ChatWidget: ChatRuntime,
    });
    const user = userEvent.setup();
    const view = render(
      <ChatwootWidget
        config={{
          platformOrigin: 'https://support.example.com',
          storefrontOrigin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-123456',
          storeSlug: 'shop',
        }}
      >
        <DeferredChatWidget loadChatWidget={loadChatWidget} />
      </ChatwootWidget>
    );

    await user.click(
      screen.getByRole('button', { name: 'Open AI chat assistant' })
    );
    await user.click(await screen.findByRole('button', { name: 'AI 0' }));
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    fireEvent(window, new Event('chatwoot:ready'));

    expect(
      screen.getByRole('button', { name: 'AI 1', hidden: true })
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'AI 1', hidden: true })
        .closest('[hidden]')
    ).toBeInTheDocument();

    view.rerender(
      <ChatwootWidget config={null}>
        <DeferredChatWidget loadChatWidget={loadChatWidget} />
      </ChatwootWidget>
    );

    expect(screen.getByRole('button', { name: 'AI 1' })).toBeInTheDocument();
  });
});
