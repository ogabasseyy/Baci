import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCartHandoff } from './use-cart-handoff';
import { widgetHost } from '../widget-host';
const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Charger', slug: 'charger', price: 9000 };
const second = { ...product, id: '22222222-2222-4222-8222-222222222222', name: 'Camera' };
beforeEach(() => { widgetHost.reset(); vi.stubGlobal('open', vi.fn(() => null)); });
afterEach(() => { widgetHost.reset(); delete window.openai; vi.unstubAllGlobals(); });
it('adds and removes through a connection-bound cart and refreshes its signed handoff for review', async () => {
  const cartId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const link = 'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const bound = (products: typeof product[], version: number) => ({ structuredContent: { success: true,
    connection_bound: true, canonical_cart_id: cartId, version, cart_url: link,
    expires_at: '2099-01-01T00:00:00.000Z', items: products.map((item) => ({ product_id: item.id, quantity: 1 })) } });
  const callTool = vi.fn().mockResolvedValueOnce(bound([product], 1)).mockResolvedValueOnce(bound([product, second], 2))
    .mockResolvedValueOnce(bound([second], 3)).mockResolvedValueOnce(bound([second], 3));
  const openExternal = vi.fn();
  window.openai = { callTool, openExternal, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => { await result.current.handleAddToCart(product); });
  await act(async () => { await result.current.handleAddToCart(second); });
  expect(result.current.cart).toHaveLength(2);
  await act(async () => { await result.current.handleRemoveItem(product.id); });
  expect(result.current.cart.map((item) => item.product.id)).toEqual([second.id]);
  expect(callTool.mock.calls[2]?.[1]).not.toHaveProperty('cart_token');
  await act(async () => { await result.current.handleViewCart(); });
  expect(callTool).toHaveBeenLastCalledWith('get_ogabassey_guest_cart', {});
  expect(openExternal).toHaveBeenCalledWith({ href: link });
  expect(result.current.cartError).toBeNull();
});
it('does not open a saved website cart when the fresh connected cart is empty', async () => {
  const cartId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const content = { success: true, connection_bound: true, canonical_cart_id: cartId, version: 1,
    cart_url: 'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    items: [{ product_id: product.id, quantity: 1 }] };
  const callTool = vi.fn().mockResolvedValueOnce({ structuredContent: content }).mockResolvedValueOnce({ structuredContent: {
    ...content, version: 2, items: [], cart_url: 'https://ogabassey.com/cart' } });
  const openExternal = vi.fn();
  window.openai = { callTool, openExternal, setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => { await result.current.handleAddToCart(product); });
  await act(async () => { await result.current.handleViewCart(); });
  expect(openExternal).not.toHaveBeenCalled();
  expect(result.current.cart).toEqual([]);
  expect(result.current.cartError).toContain('empty');
});
it('recovers the current version after chat changes the cart, so the next widget add can succeed', async () => {
  const base = { success: true, connection_bound: true, canonical_cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cart_url: 'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const state = (quantity: number, version: number) => ({ structuredContent: { ...base, version, items: [{ product_id: product.id, quantity }] } });
  const callTool = vi.fn().mockResolvedValueOnce(state(1, 1))
    .mockResolvedValueOnce({ structuredContent: { success: false, connection_bound: true, code: 'version_conflict', version: 5 } })
    .mockResolvedValueOnce(state(3, 5)).mockResolvedValueOnce(state(4, 6));
  window.openai = { callTool, openExternal: vi.fn(), setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => { await result.current.handleAddToCart(product); });
  await act(async () => { await result.current.handleAddToCart(product); });
  expect(result.current.cart[0]?.quantity).toBe(3);
  await act(async () => { await result.current.handleAddToCart(product); });
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', expect.objectContaining({ quantity: 4, expectedVersion: 5 }));
  expect(result.current.cart[0]?.quantity).toBe(4);
});
it('clears a previous refresh error after a connected review succeeds', async () => {
  const content = { success: true, connection_bound: true, canonical_cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1,
    cart_url: 'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    items: [{ product_id: product.id, quantity: 1 }] };
  const callTool = vi.fn().mockResolvedValueOnce({ structuredContent: content }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ structuredContent: content });
  window.openai = { callTool, openExternal: vi.fn(), setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => { await result.current.handleAddToCart(product); });
  await act(async () => { await result.current.handleViewCart(); });
  expect(result.current.cartError).not.toBeNull();
  await act(async () => { await result.current.handleViewCart(); });
  expect(result.current.cartError).toBeNull();
});
it('refreshes after a removal conflict so the next removal uses the current version', async () => {
  const content = { success: true, connection_bound: true, canonical_cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cart_url: 'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const state = (items: typeof product[], version: number) => ({ structuredContent: { ...content, version, items: items.map((p) => ({ product_id: p.id, quantity: 1 })) } });
  const callTool = vi.fn().mockResolvedValueOnce(state([product], 1)).mockResolvedValueOnce(state([product, second], 2))
    .mockResolvedValueOnce({ structuredContent: { success: false, connection_bound: true, code: 'version_conflict', version: 4 } })
    .mockResolvedValueOnce(state([product, second], 4)).mockResolvedValueOnce(state([second], 5));
  window.openai = { callTool, openExternal: vi.fn(), setWidgetState: vi.fn() };
  const { result } = renderHook(() => useCartHandoff());
  await act(async () => { await result.current.handleAddToCart(product); });
  await act(async () => { await result.current.handleAddToCart(second); });
  await act(async () => { await result.current.handleRemoveItem(product.id); });
  await act(async () => { await result.current.handleRemoveItem(product.id); });
  expect(callTool).toHaveBeenLastCalledWith('update_ogabassey_guest_cart', expect.objectContaining({ quantity: 0, expectedVersion: 4 }));
  expect(result.current.cart.map((line) => line.product.id)).toEqual([second.id]);
});
