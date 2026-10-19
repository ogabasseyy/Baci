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
    setMerchantSlug: cartMocks.setMerchantSlug,
  }),
}));

// Mock next/font/google to prevent font loading errors in tests
vi.mock('next/font/google', () => ({
  Mountains_of_Christmas: vi.fn(() => ({
    className: 'mocked-font-class',
  })),
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
        merchant_id: 'ogabassey',
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

function startChatAndSendWish() {
  fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send wish' }));
}

describe('SantaChatDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cartMocks.cart = [];
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports a valid component', () => {
    expect(SantaChatDialog).toBeDefined();
    expect(typeof SantaChatDialog).toBe('function');
  });

  it('processes multiple cart directives concurrently and strips them from displayed text', async () => {
    const productRequests: string[] = [];
    const productResolvers: Array<() => void> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/chat/santa') {
        return Promise.resolve(
          makeStreamingResponse(
            'Santa says yes. ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000 ACTION:ADD_TO_CART|PRODUCT:Case|PRICE:12,000',
            'winter-store'
          )
        );
      }

      if (url === '/api/chat/santa/product') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        productRequests.push(body.name);

        return new Promise<Response>((resolve) => {
          productResolvers.push(() => {
            resolve(
              makeProductResponse(
                body.name,
                body.name === 'Phone' ? 450_000 : 12_000,
                'winter-store'
              )
            );
          });
        });
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);

    startChatAndSendWish();

    await waitFor(() => {
      expect(productRequests).toEqual(['Phone', 'Case']);
    });

    const assistantText = screen
      .getAllByRole('article', { name: 'assistant message' })
      .map((element) => element.textContent)
      .join(' ');
    expect(assistantText).toContain('Santa says yes.');
    expect(assistantText).not.toContain('ACTION:ADD_TO_CART');

    productResolvers.forEach((resolveProduct) => {
      resolveProduct();
    });

    await waitFor(() => {
      expect(cartMocks.addToCart).toHaveBeenCalledTimes(2);
    });
    expect(productRequests).toHaveLength(2);
  });

  it('shows a chat error when the Santa endpoint fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 })))
    );

    render(<SantaChatDialog />);

    startChatAndSendWish();

    await waitFor(() => {
      expect(screen.getByText(/snowstorm interfering/i)).toBeInTheDocument();
    });
    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not add to cart when product lookup returns a 404', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
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
        return Promise.resolve(new Response(null, { status: 404 }));
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);

    startChatAndSendWish();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/santa/product',
        expect.objectContaining({ method: 'POST' })
      );
    });
    expect(cartMocks.addToCart).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('keeps successful cart additions when another product lookup fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const productRequests: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/chat/santa') {
        return Promise.resolve(
          makeStreamingResponse(
            'ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000 ACTION:ADD_TO_CART|PRODUCT:Case|PRICE:12,000',
            'winter-store'
          )
        );
      }

      if (url === '/api/chat/santa/product') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        productRequests.push(body.name);
        if (body.name === 'Case') {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        return Promise.resolve(
          makeProductResponse(body.name, 450_000, 'winter-store')
        );
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SantaChatDialog />);

    startChatAndSendWish();

    await waitFor(() => {
      expect(productRequests).toEqual(['Phone', 'Case']);
    });
    await waitFor(() => {
      expect(cartMocks.addToCart).toHaveBeenCalledTimes(1);
    });
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Phone' }),
      1
    );
    consoleSpy.mockRestore();
  });
});
