import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveChatwootCheckoutKeys } from './chatwoot-checkout-keys';

afterEach(() => vi.unstubAllGlobals());

describe('deriveChatwootCheckoutKeys', () => {
  it('is deterministic and fits the order API key bounds', async () => {
    const first = await deriveChatwootCheckoutKeys(
      'request-0001',
      'merchant-1'
    );
    const second = await deriveChatwootCheckoutKeys(
      'request-0001',
      'merchant-1'
    );

    expect(first).toEqual(second);
    expect(first?.idempotencyKey).toMatch(/^cw-chk-[0-9a-f]{64}$/);
    expect(first?.operationId).toMatch(/^cw-op-[0-9a-f]{64}$/);
    expect(first?.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(first?.idempotencyKey.length).toBeLessThanOrEqual(128);
  });

  it('differs for another request id or another merchant', async () => {
    const base = await deriveChatwootCheckoutKeys('request-0001', 'merchant-1');

    expect(
      await deriveChatwootCheckoutKeys('request-0002', 'merchant-1')
    ).not.toEqual(base);
    expect(
      await deriveChatwootCheckoutKeys('request-0001', 'merchant-2')
    ).not.toEqual(base);
  });

  it('returns null when hashing is unavailable', async () => {
    vi.stubGlobal('crypto', {});

    expect(
      await deriveChatwootCheckoutKeys('request-0001', 'merchant-1')
    ).toBeNull();
  });
});
