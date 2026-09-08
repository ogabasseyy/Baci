import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

const chatMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  parseSantaActions: vi.fn(),
  setIsCartOpen: vi.fn(),
  stripSantaActions: vi.fn((content: string) => content),
}));

// Mock useCart before importing the hook
vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    addToCart: chatMocks.addToCart,
    setIsCartOpen: chatMocks.setIsCartOpen,
  })),
}));

// Mock Santa action helpers to avoid coupling these hook tests to parser details.
vi.mock('@/components/storefront/santa-chat/types', () => ({
  parseSantaActions: chatMocks.parseSantaActions,
  stripSantaActions: chatMocks.stripSantaActions,
}));

import { useOgabasseyChat } from './use-ogabassey-chat';

describe('useOgabasseyChat - agent UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn();
  });
  it('stores validated generative UI events on the assistant message', async () => {
    const event = {
      intent: 'discover' as const,
      products: [
        {
          brand: 'Apple',
          category: 'Smartphones',
          description: null,
          hasVariants: false,
          id: 'product-1',
          imageUrl: null,
          manageStock: false,
          name: 'iPhone 16',
          price: 1_200_000,
          slug: 'iphone-16',
          stock: null,
        },
      ],
      title: 'Products I found',
      type: 'present_products' as const,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          events: [event],
          text: 'Here is one phone.',
          version: 1,
        }),
        { headers: { 'Content-Type': storefrontAgentUiContract.mediaType } }
      )
    );

    const { result } = renderHook(() => useOgabasseyChat({ isSanta: false }));

    await act(async () => {
      await result.current.handleSend('Show me phones');
    });

    const responseMessage = result.current.messages.at(-1);
    expect(responseMessage?.text).toBe('Here is one phone.');
    expect(responseMessage?.uiEvents).toEqual([event]);
  });

});
