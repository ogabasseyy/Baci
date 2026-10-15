import { describe, expect, it } from 'vitest';
import {
  assertUcpCartNotMigrated,
  buildUcpCartInsert,
  buildUcpCartUpdate,
  mapUcpCartStatus,
  mapUcpCartWriteError,
  UcpCartMigratedError,
  ucpCartCallerMismatch,
} from './ucp-cart-storage';

describe('ucp cart storage', () => {
  it('builds a merchant-scoped cart insert', () => {
    expect(
      buildUcpCartInsert({
        cartId: 'cart_123',
        currency: 'ngn',
        items: [{ id: 'product-1', quantity: 2 }],
        merchantId: 'merchant-1',
        metadata: { source: 'ucp' },
      })
    ).toMatchObject({
      cart_id: 'cart_123',
      cart_items: [{ id: 'product-1', quantity: 2 }],
      currency: 'NGN',
      merchant_id: 'merchant-1',
      status: 'active',
    });
  });

  it('does not clear buyer context on line item updates', () => {
    expect(
      buildUcpCartUpdate({
        existingBuyer: { email: 'buyer@example.com' },
        items: [{ id: 'product-2', quantity: 1 }],
      })
    ).toMatchObject({
      buyer: { email: 'buyer@example.com' },
      cart_items: [{ id: 'product-2', quantity: 1 }],
      status: 'active',
    });
  });

  it('maps internal statuses to UCP statuses', () => {
    expect(mapUcpCartStatus('active')).toBe('active');
    expect(mapUcpCartStatus('converted')).toBe('converted');
    expect(mapUcpCartStatus('canceled')).toBe('canceled');
    expect(mapUcpCartStatus('expired')).toBe('expired');
  });

  it('passes unmigrated carts and blocks migrated ones with refresh', () => {
    expect(() =>
      assertUcpCartNotMigrated({ migratedToCartId: null })
    ).not.toThrow();
    expect(() => assertUcpCartNotMigrated({})).not.toThrow();

    let failure: unknown;
    try {
      assertUcpCartNotMigrated({ migratedToCartId: 'canonical-1' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(UcpCartMigratedError);
    expect((failure as UcpCartMigratedError).code).toBe('refresh_required');
    expect((failure as UcpCartMigratedError).cartId).toBe('canonical-1');
    expect((failure as UcpCartMigratedError).retryable).toBe(true);
  });

  it('maps fence violations to the migrated error and leaves others alone', () => {
    const fenced = mapUcpCartWriteError({
      code: 'P0001',
      message: 'migrated cart is read-only',
    });
    expect(fenced).toBeInstanceOf(UcpCartMigratedError);

    const outage = new Error('fetch failed');
    expect(mapUcpCartWriteError(outage)).toBe(outage);
  });
});

describe('ucpCartCallerMismatch', () => {
  it('denies legacy null-owner carts for reads and writes', () => {
    const legacy = { agent_id: null };
    expect(ucpCartCallerMismatch(legacy, 'agent-b')).toBe(true);
    expect(ucpCartCallerMismatch(legacy, 'agent-b', { mutation: true })).toBe(
      true
    );
    expect(ucpCartCallerMismatch(legacy, null, { mutation: true })).toBe(true);
  });

  it('scopes recorded carts to their creating caller for reads and writes', () => {
    const owned = { agent_id: 'agent-a' };
    expect(ucpCartCallerMismatch(owned, 'agent-a')).toBe(false);
    expect(ucpCartCallerMismatch(owned, 'agent-a', { mutation: true })).toBe(
      false
    );
    expect(ucpCartCallerMismatch(owned, 'agent-b')).toBe(true);
    expect(ucpCartCallerMismatch(owned, 'agent-b', { mutation: true })).toBe(
      true
    );
  });
});
