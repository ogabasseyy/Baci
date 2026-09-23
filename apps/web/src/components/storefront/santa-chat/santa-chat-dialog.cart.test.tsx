import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';
import { SantaChatDialog } from './santa-chat-dialog';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  applyNegotiatedPrice: vi.fn(),
  cart: [] as Array<{ cartItemId: string }>,
  setMerchantSlug: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    applyNegotiatedPrice: cartMocks.applyNegotiatedPrice,
    cart: cartMocks.cart,
    cartCount: 0,
    merchantSlug: null,
    setMerchantSlug: cartMocks.setMerchantSlug,
  }),
}));

vi.mock('next/font/google', () => ({
  Mountains_of_Christmas: vi.fn(() => ({ className: 'mocked-font-class' })),
}));

vi.mock('./welcome-screen', () => ({
  WelcomeScreen: ({ onStart }: { onStart: () => void }) => (
    <button type="button" onClick={onStart}>
      Start chat
    </button>
  ),
}));

vi.mock('./chat-input', () => ({
  ChatInput: ({
    isLoading,
    onSendMessage,
  }: {
    isLoading: boolean;
    onSendMessage: (message: { content: string }) => void;
  }) => (
    <button
      type="button"
      disabled={isLoading}
      onClick={() => onSendMessage({ content: 'Please add my wishes' })}
    >
      Send wish
    </button>
  ),
}));

vi.mock('./chat-message', () => ({
  ChatMessage: ({
    message,
  }: {
    message: { role: 'user' | 'assistant'; content: string };
  }) => (
    <article aria-label={`${message.role} message`}>{message.content}</article>
  ),
}));

function makeStreamingResponse(
  content: string,
  merchantSlug?: string
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    }),
    {
      headers: merchantSlug
        ? { [SANTA_MERCHANT_SLUG_HEADER]: merchantSlug }
        : undefined,
      status: 200,
    }
  );
}

function makeProductResponse(
  name: string,
  price: number,
  merchantSlug?: string
): Response {
  return new Response(
    JSON.stringify({
      product: {
        id: name.toLowerCase(),
        merchant_id: merchantSlug ?? 'ogabassey',
        name,
        price,
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...(merchantSlug ? { [SANTA_MERCHANT_SLUG_HEADER]: merchantSlug } : {}),
      },
      status: 200,
    }
  );
}

describe('SantaChatDialog cart tenant handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render a hardcoded merchant attribution', () => {
    render(<SantaChatDialog />);

    expect(screen.queryByText('by Ogabassey')).not.toBeInTheDocument();
  });

  it('adopts the resolved Santa tenant before processing cart actions', async () => {
    const invocationOrder: string[] = [];
    cartMocks.setMerchantSlug.mockImplementation(() => {
      invocationOrder.push('setMerchantSlug');
    });
    cartMocks.addToCart.mockImplementation(() => {
      invocationOrder.push('addToCart');
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/santa') {
        return Promise.resolve(
          makeStreamingResponse(
            'ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000',
            'winter-store'
          )
        );
      }
      if (url === '/api/chat/santa/product') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return Promise.resolve(
          makeProductResponse(body.name, 450_000, 'winter-store')
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send wish' }));

    await waitFor(() => {
      expect(cartMocks.setMerchantSlug).toHaveBeenCalledWith('winter-store');
      expect(cartMocks.addToCart).toHaveBeenCalled();
      expect(invocationOrder.indexOf('setMerchantSlug')).toBeLessThan(
        invocationOrder.indexOf('addToCart')
      );
    });
  });

  it('refuses the add when the product tenant differs from the reply tenant', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/santa') {
        return Promise.resolve(
          makeStreamingResponse(
            'ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000',
            'winter-store'
          )
        );
      }
      if (url === '/api/chat/santa/product') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return Promise.resolve(
          makeProductResponse(body.name, 450_000, 'other-store')
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send wish' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/santa/product',
        expect.objectContaining({ method: 'POST' })
      );
    });
    // Let the rejected add settle, then assert nothing was added or adopted.
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Santa Cart] Resolved tenant differs from storefront',
        expect.objectContaining({ expectedMerchantSlug: 'winter-store' })
      );
    });
    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    expect(cartMocks.setMerchantSlug).not.toHaveBeenCalledWith('other-store');
    consoleSpy.mockRestore();
  });

  it('refuses the add when the reply carries no attested tenant', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/santa') {
        return Promise.resolve(
          makeStreamingResponse('ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000')
        );
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send wish' }));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Santa Cart] Missing resolved merchant slug'
      );
    });
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input === '/api/chat/santa/product'
      )
    ).toBe(false);
    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
