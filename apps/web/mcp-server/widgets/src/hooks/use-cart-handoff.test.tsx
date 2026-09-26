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
    window.openai = { callTool: vi.fn().mockRejectedValue(new Error('offline')) };
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

  it('opens the validated cart in a browser tab when ChatGPT navigation is unavailable', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    window.openai = { callTool: vi.fn().mockResolvedValue({ structuredContent: {
      success: true, cart_url: 'https://ogabassey.com/cart?item_id=phone-1',
    } }) };
    const { result } = renderHook(() => useCartHandoff());
    await act(async () => { await result.current.handleAddToCart(product); });
    act(() => { result.current.handleViewCart(); });
    expect(open).toHaveBeenCalledWith('https://ogabassey.com/cart?item_id=phone-1', '_blank');
    open.mockRestore();
  });
});
