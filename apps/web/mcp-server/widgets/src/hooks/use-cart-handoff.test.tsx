import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';

const product = { id: 'phone-1', name: 'Redmi', slug: 'redmi', price: 90000 };

afterEach(() => { delete window.openai; });

describe('useCartHandoff', () => {
  it('identifies a missing ChatGPT tool capability without blaming product availability', async () => {
    window.openai = {};
    const { result } = renderHook(() => useCartHandoff());
    await act(async () => { await result.current.handleAddToCart(product); });
    expect(result.current.cart).toEqual([]);
    expect(result.current.cartError).toContain('ChatGPT cannot open the cart');
    expect(result.current.cartError).not.toContain('unavailable');
  });

  it('reports tool failures without creating a shopping link', async () => {
    window.openai = { openExternal: vi.fn(), callTool: vi.fn().mockRejectedValue(new Error('offline')) };
    const { result } = renderHook(() => useCartHandoff());
    await act(async () => { await result.current.handleAddToCart(product); });
    expect(result.current.cart).toEqual([]);
    expect(result.current.cartError).toContain('Could not open the cart');
  });

  it('removes a prepared link when the shopper removes its product', async () => {
    const openExternal = vi.fn();
    window.openai = {
      callTool: vi.fn().mockResolvedValue({ structuredContent: {
        success: true, cart_url: 'https://ogabassey.com/cart?item_id=phone-1',
      } }),
      setWidgetState: vi.fn(),
      openExternal,
    };
    const { result } = renderHook(() => useCartHandoff());
    await act(async () => { await result.current.handleAddToCart(product); });
    expect(result.current.cart).toHaveLength(1);
    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/cart?item_id=phone-1' });
    act(() => { result.current.handleRemoveItem(product.id); });
    expect(result.current.cart).toEqual([]);
    expect(window.openai?.setWidgetState).toHaveBeenLastCalledWith({ cart: [], cartUrl: undefined });
  });

  it('opens a slugless option product by ID for variant selection', async () => {
    const openExternal = vi.fn();
    window.openai = {
      openExternal,
      callTool: vi.fn().mockResolvedValue({ structuredContent: {
        success: false,
        requires_variant_selection: true,
        product_id: 'phone-1',
        product_url: 'https://ogabassey.com/products/phone-1',
      } }),
    };
    const { result } = renderHook(() => useCartHandoff());

    await act(async () => { await result.current.handleAddToCart({ ...product, slug: null }); });

    expect(openExternal).toHaveBeenCalledWith({ href: 'https://ogabassey.com/products/phone-1' });
    expect(result.current.cartError).toBeNull();
  });

  it('opens the validated cart in a browser tab when ChatGPT navigation is unavailable', async () => {
    const pendingTab = { location: { href: 'about:blank' }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(pendingTab).mockReturnValue(null);
    window.openai = { callTool: vi.fn().mockResolvedValue({ structuredContent: {
      success: true, cart_url: 'https://ogabassey.com/cart?item_id=phone-1',
    } }) };
    const { result } = renderHook(() => useCartHandoff());
    await act(async () => { await result.current.handleAddToCart(product); });
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(pendingTab.location.href).toBe('https://ogabassey.com/cart?item_id=phone-1');
    act(() => { result.current.handleViewCart(); });
    expect(open).toHaveBeenCalledWith('https://ogabassey.com/cart?item_id=phone-1', '_blank');
    open.mockRestore();
  });

  it('reports a blocked fallback tab before requesting a cart handoff', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const callTool = vi.fn();
    window.openai = { callTool };
    try {
      const { result } = renderHook(() => useCartHandoff());
      await act(async () => { await result.current.handleAddToCart(product); });
      expect(callTool).not.toHaveBeenCalled();
      expect(result.current.cartError).toContain('blocked the cart tab');
    } finally {
      open.mockRestore();
    }
  });

  it('closes the reserved tab if the cart tool fails', async () => {
    const pendingTab = { location: { href: 'about:blank' }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(pendingTab);
    window.openai = { callTool: vi.fn().mockRejectedValue(new Error('offline')) };
    try {
      const { result } = renderHook(() => useCartHandoff());
      await act(async () => { await result.current.handleAddToCart(product); });
      expect(pendingTab.close).toHaveBeenCalledOnce();
      expect(result.current.cartError).toContain('Could not open the cart');
    } finally {
      open.mockRestore();
    }
  });
});
