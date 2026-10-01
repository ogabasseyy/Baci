import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANTA_GREETING } from '@/ai/prompts/santa';
import { useSantaChat } from './use-santa-chat';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  applyNegotiatedPrice: vi.fn(),
  cart: [] as Array<{ cartItemId: string }>,
  cartCount: 0,
  setMerchantSlug: vi.fn(),
}));

vi.mock('@/hooks/use-cart', () => ({
  useCart: () => cartMocks,
}));

describe('useSantaChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on the welcome screen with no assumed tenant', () => {
    const { result } = renderHook(() => useSantaChat());

    expect(result.current.showWelcome).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.merchantSlug).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('greets with Santa on chat start', () => {
    const { result } = renderHook(() => useSantaChat());

    act(() => {
      result.current.handleStartChat();
    });

    expect(result.current.showWelcome).toBe(false);
    expect(result.current.messages).toEqual([
      { id: 'greeting', role: 'assistant', content: SANTA_GREETING },
    ]);
  });

  it('surfaces a chat error when the Santa endpoint fails', async () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const { result } = renderHook(() => useSantaChat());

    act(() => {
      result.current.handleStartChat();
    });

    await act(async () => {
      result.current.handleSendMessage({ content: 'Hello Santa' });
    });

    expect(result.current.error).toMatch(/snowstorm interfering/i);
    expect(result.current.isLoading).toBe(false);
    consoleSpy.mockRestore();
  });
});
