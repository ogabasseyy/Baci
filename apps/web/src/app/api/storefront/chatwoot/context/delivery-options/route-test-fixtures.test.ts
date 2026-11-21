import { describe, expect, it } from 'vitest';
import {
  binding,
  cart,
  cartContextState,
  loadedContext,
  request,
} from './route-test-fixtures';

describe('delivery-options route test fixtures', () => {
  it('builds a POST request to the delivery-options endpoint', () => {
    const req = request();

    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toContain('delivery-options');
  });

  it('applies overrides on top of the default loaded context', () => {
    const base = loadedContext();
    const overridden = loadedContext({ extra: 'x' });

    expect(overridden.ok).toBe(true);
    expect(overridden.cart).toMatchObject({ extra: 'x' });
    expect(base.cart).not.toHaveProperty('extra');
  });

  it('exposes a binding, cart and cart state for the tests', () => {
    expect(binding).toBeTruthy();
    expect(cart).toBeTruthy();
    expect(cartContextState).toBeTruthy();
  });
});
