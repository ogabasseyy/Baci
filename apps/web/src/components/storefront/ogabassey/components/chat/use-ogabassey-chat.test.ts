import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  applyNegotiatedPrice: vi.fn(),
  parseSantaActions: vi.fn(),
  setIsCartOpen: vi.fn(),
  stripSantaActions: vi.fn((content: string) => content),
}));

// Mock useCart before importing the hook
vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    addToCart: chatMocks.addToCart,
    applyNegotiatedPrice: chatMocks.applyNegotiatedPrice,
    setIsCartOpen: chatMocks.setIsCartOpen,
  })),
}));

// Mock Santa action helpers to avoid coupling these hook tests to parser details.
vi.mock('@/components/storefront/santa-chat/types', () => ({
  parseSantaActions: chatMocks.parseSantaActions,
  stripSantaActions: chatMocks.stripSantaActions,
}));

import { useOgabasseyChat } from './use-ogabassey-chat';

// Helper to create a streaming response body from a string
function makeStreamingResponse(text: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return {
    ok: true,
    body: stream,
  };
}

describe('useOgabasseyChat - initial state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMocks.parseSantaActions.mockReturnValue([]);
    chatMocks.stripSantaActions.mockImplementation((content: string) => content);
    window.localStorage.clear();
    global.fetch = vi.fn();
  });

  it('initializes isOpen as false', () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));
    expect(result.current.isOpen).toBe(false);
  });

  it('initializes messages as empty array', () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));
    expect(result.current.messages).toHaveLength(0);
  });

  it('initializes input as empty string', () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));
    expect(result.current.input).toBe('');
  });

  it('initializes isLoading as false', () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));
    expect(result.current.isLoading).toBe(false);
  });

  it('returns a messagesEndRef object', () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));
    expect(result.current.messagesEndRef).toBeDefined();
    expect(typeof result.current.messagesEndRef).toBe('object');
  });
});

describe('useOgabasseyChat - welcome message on open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn();
  });

  it('adds a welcome message when chat is opened for the first time (standard mode)', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    act(() => {
      result.current.setIsOpen(true);
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
    });

    expect(result.current.messages[0].role).toBe('model');
    expect(result.current.messages[0].text).toBe('Hello! How can I help you today?');
  });

  it('adds a santa welcome message when chat is opened in santa mode', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    act(() => {
      result.current.setIsOpen(true);
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
    });

    expect(result.current.messages[0].text).toBe('Ho ho ho! How can Santa AI help you today?');
  });

  it('clears the proactive message when chat is opened', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    act(() => {
      result.current.setProactiveMsg('Looking for a new phone?');
    });

    act(() => {
      result.current.setIsOpen(true);
    });

    await waitFor(() => {
      expect(result.current.proactiveMsg).toBeNull();
    });
  });
});

describe('useOgabasseyChat - handleSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn();
  });

  it('adds user message to messages when handleSend is called', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('This is a response.')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('What phones do you have?');
    });

    const userMessages = result.current.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].text).toBe('What phones do you have?');
  });

  it('calls fetch with the correct endpoint for standard mode', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Response text')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('includes a stable browser chat session id in standard chat requests', async () => {
    window.localStorage.setItem(
      'ogabassey_chat_session_id',
      'og_chat_existing_session_1234'
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Response text')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    const requestInit = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      sessionId: 'og_chat_existing_session_1234',
    });
  });

  it('calls fetch with /api/chat/santa endpoint in santa mode', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Ho ho ho!')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    await act(async () => {
      await result.current.handleSend('I want a phone');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chat/santa',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not include standard chat session id in santa requests', async () => {
    window.localStorage.setItem(
      'ogabassey_chat_session_id',
      'og_chat_existing_session_1234'
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Ho ho ho!')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    await act(async () => {
      await result.current.handleSend('I want a phone');
    });

    const requestInit = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).not.toHaveProperty(
      'sessionId'
    );
  });

  it('adds AI response message after successful fetch', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Here are our latest phones!')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Show me phones');
    });

    const modelMessages = result.current.messages.filter((m) => m.role === 'model');
    expect(modelMessages.length).toBeGreaterThan(0);
    expect(modelMessages[modelMessages.length - 1].text).toContain('Here are our latest phones!');
  });

  it('clears input after sending', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Response')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    act(() => {
      result.current.setInput('Test message');
    });

    await act(async () => {
      await result.current.handleSend('Test message');
    });

    expect(result.current.input).toBe('');
  });

  it('sets isLoading to false after request completes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Response done')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('handles fetch error gracefully and adds error message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    const modelMessages = result.current.messages.filter((m) => m.role === 'model');
    expect(modelMessages.length).toBeGreaterThan(0);
    expect(modelMessages[modelMessages.length - 1].text).toContain(
      "I'm having trouble connecting right now"
    );
  });

  it('handles fetch error gracefully with santa error message in santa mode', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    await act(async () => {
      await result.current.handleSend('I want a gift');
    });

    const modelMessages = result.current.messages.filter((m) => m.role === 'model');
    expect(modelMessages[modelMessages.length - 1].text).toContain(
      "Santa's workshop is a bit busy"
    );
  });

  it('handles non-ok response by adding error message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Hello');
    });

    const modelMessages = result.current.messages.filter((m) => m.role === 'model');
    expect(modelMessages[modelMessages.length - 1].text).toContain(
      "I'm having trouble connecting right now"
    );
  });

  it('does nothing when message text is empty', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('');
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('does nothing when message text is only whitespace', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('   ');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stores every parsed Santa action on the assistant message', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'iPhone 15', price: 600000 },
      { type: 'ADD_TO_CART', productName: 'Pixel 9', price: 500000 },
    ]);
    chatMocks.stripSantaActions.mockReturnValueOnce('Two gifts are ready.');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directives')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    await act(async () => {
      await result.current.handleSend('I want two phones');
    });

    const modelMessage = result.current.messages.find(
      (message) => message.role === 'model'
    );
    expect(modelMessage?.text).toBe('Two gifts are ready.');
    expect(modelMessage?.santaActions).toEqual([
      { productName: 'iPhone 15', price: 600000, added: false },
      { productName: 'Pixel 9', price: 500000, added: false },
    ]);
  });

  it('adds the selected Santa action and marks only that action as added', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'iPhone 15', price: 600000 },
      { type: 'ADD_TO_CART', productName: 'Pixel 9', price: 500000 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directives')
    );

    const { result } = renderHook(() =>
      useOgabasseyChat({ isSanta: true, storefrontSlug: 'ogabassey' })
    );

    await act(async () => {
      await result.current.handleSend('I want two phones');
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      headers: new Headers({ 'x-baci-santa-merchant-slug': 'ogabassey' }),
      json: async () => ({
        product: {
          id: 'product-9',
          merchant_id: 'merchant-9',
          name: 'Pixel 9',
          slug: 'pixel-9',
          description: '',
          price: 650000,
          max_discount_percentage: 2,
          image: '',
          imageLarge: '',
          imageHint: 'Pixel 9',
          status: 'active',
          stock: 1,
          manage_stock: true,
          brand: '',
          sku: '',
          gtin: '',
          mpn: '',
        },
      }),
      ok: true,
    });

    await act(async () => {
      await result.current.handleAddSantaWishToCart(1, 1);
    });

    expect(chatMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Pixel 9',
        price: 650000,
      }),
      1
    );
    // A 23% model grant exceeds the 2% product ceiling: the wish is still
    // fulfilled at catalog price, but the untrusted price is not applied.
    expect(chatMocks.applyNegotiatedPrice).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.santaActions).toEqual([
      { productName: 'iPhone 15', price: 600000, added: false },
      { productName: 'Pixel 9', price: 500000, added: true },
    ]);
    expect(chatMocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('applies a Santa grant inside the server product ceiling', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'Pixel 9', price: 637000 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directive')
    );

    const { result } = renderHook(() =>
      useOgabasseyChat({ isSanta: true, storefrontSlug: 'ogabassey' })
    );

    await act(async () => {
      await result.current.handleSend('I want a phone');
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      headers: new Headers({ 'x-baci-santa-merchant-slug': 'ogabassey' }),
      json: async () => ({
        product: {
          id: 'product-9',
          merchant_id: 'merchant-9',
          name: 'Pixel 9',
          slug: 'pixel-9',
          description: '',
          price: 650000,
          max_discount_percentage: 2,
          image: '',
          imageLarge: '',
          imageHint: 'Pixel 9',
          status: 'active',
          stock: 1,
          manage_stock: true,
          brand: '',
          sku: '',
          gtin: '',
          mpn: '',
        },
      }),
      ok: true,
    });

    await act(async () => {
      await result.current.handleAddSantaWishToCart(1);
    });

    expect(chatMocks.addToCart).toHaveBeenCalled();
    expect(chatMocks.applyNegotiatedPrice).toHaveBeenCalledWith(
      'product-9',
      637000
    );
    expect(result.current.messages[1]?.santaActions?.[0]?.added).toBe(true);
  });

  it('does not mark the action added when the product is out of stock', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'Pixel 9', price: 637000 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directive')
    );

    const { result } = renderHook(() =>
      useOgabasseyChat({ isSanta: true, storefrontSlug: 'ogabassey' })
    );

    await act(async () => {
      await result.current.handleSend('I want a phone');
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      headers: new Headers({ 'x-baci-santa-merchant-slug': 'ogabassey' }),
      json: async () => ({
        product: {
          id: 'product-9',
          merchant_id: 'merchant-9',
          name: 'Pixel 9',
          slug: 'pixel-9',
          description: '',
          price: 650000,
          max_discount_percentage: 2,
          image: '',
          imageLarge: '',
          imageHint: 'Pixel 9',
          status: 'active',
          stock: 0,
          manage_stock: true,
          brand: '',
          sku: '',
          gtin: '',
          mpn: '',
        },
      }),
      ok: true,
    });

    await act(async () => {
      await result.current.handleAddSantaWishToCart(1);
    });

    expect(chatMocks.addToCart).not.toHaveBeenCalled();
    expect(chatMocks.applyNegotiatedPrice).not.toHaveBeenCalled();
    expect(chatMocks.setIsCartOpen).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.santaActions?.[0]?.added).toBe(false);
  });

  it('does not add a malformed product lookup response to the cart', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'Pixel 9', price: 500000 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directive')
    );
    const { result } = renderHook(() =>
      useOgabasseyChat({ isSanta: true, storefrontSlug: 'ogabassey' })
    );
    await act(async () => {
      await result.current.handleSend('I want a phone');
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      headers: new Headers({ 'x-baci-santa-merchant-slug': 'ogabassey' }),
      json: async () => ({
        product: { id: 'product-9', name: 'Pixel 9', price: 650000 },
      }),
      ok: true,
    });

    await act(async () => {
      await result.current.handleAddSantaWishToCart(1);
    });

    expect(chatMocks.addToCart).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.santaActions?.[0]?.added).toBe(false);
  });

  it('safely ignores an out-of-bounds Santa action index', async () => {
    chatMocks.parseSantaActions.mockReturnValueOnce([
      { type: 'ADD_TO_CART', productName: 'iPhone 15', price: 600000 },
    ]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('raw Santa directive')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: true }));

    await act(async () => {
      await result.current.handleSend('I want a phone');
    });

    act(() => {
      result.current.handleAddSantaWishToCart(1, 99);
    });

    expect(chatMocks.addToCart).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.santaActions?.[0]?.added).toBe(false);
  });
});

describe('useOgabasseyChat - handleSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn();
  });

  it('prevents default form submission', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    act(() => {
      result.current.handleSubmit(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does not call fetch when input is empty on submit', async () => {
    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    await act(async () => {
      result.current.handleSubmit(mockEvent);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls fetch when input has content on submit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeStreamingResponse('Response')
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    act(() => {
      result.current.setInput('What are your prices?');
    });

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    await act(async () => {
      result.current.handleSubmit(mockEvent);
      // Allow promises to resolve
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
