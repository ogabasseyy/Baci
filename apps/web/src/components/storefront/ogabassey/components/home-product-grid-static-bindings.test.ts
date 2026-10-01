import { describe, expect, it, vi } from 'vitest';
import { STATIC_BINDINGS } from './home-product-grid-static-bindings';

describe('home-product-grid-static-bindings', () => {
  it('exposes inert pre-activation bindings', () => {
    expect(STATIC_BINDINGS.isAdded('anything')).toBe(false);
    expect(STATIC_BINDINGS.getCartQuantity('anything')).toBe(0);
    expect(STATIC_BINDINGS.isWishlisted('anything')).toBe(false);
    expect(STATIC_BINDINGS.particles).toEqual([]);

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as Parameters<typeof STATIC_BINDINGS.onAddToCart>[0];
    STATIC_BINDINGS.onAddToCart(event, { id: 'p1' } as never);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
});
