import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoveryFailure } from './route.failure';

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));

describe('checkout recovery error responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns forbidden without exposing the database message', async () => {
    const response = recoveryFailure({
      message: 'forbidden_shipping_recovery: private details',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it.each([
    ['shipping_recovery_price_changed', 'SHIPPING_RECOVERY_PRICE_CHANGED'],
    [
      'shipping_recovery_funding_not_ready',
      'SHIPPING_RECOVERY_FUNDING_NOT_READY',
    ],
    ['shipping_recovery_expired', 'SHIPPING_RECOVERY_STALE'],
    ['shipping_recovery_stale', 'SHIPPING_RECOVERY_STALE'],
    ['shipping_recovery_unavailable', 'SHIPPING_RECOVERY_UNAVAILABLE'],
    ['order_refunded', 'SHIPPING_RECOVERY_UNAVAILABLE'],
    ['order_cancelled', 'SHIPPING_RECOVERY_UNAVAILABLE'],
  ])('maps %s to its specific conflict response', async (message, code) => {
    const response = recoveryFailure({ message });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: expect.any(String), code });
  });

  it.each([
    '40001',
    '40P01',
  ])('makes SQL concurrency error %s retryable without matching message text', async (code) => {
    const response = recoveryFailure({
      code,
      message: 'private database details',
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        'This preview expired or the order changed. Review the destination and preview again.',
      code: 'SHIPPING_RECOVERY_STALE',
    });
  });

  it('distinguishes signing outages and logs only the safe code and summary', async () => {
    const response = recoveryFailure({
      message: 'shipping_recovery_signing_unavailable: private signing details',
      code: '42501',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        'Shipping recovery signing is temporarily unavailable. Please try again later.',
      code: 'SHIPPING_RECOVERY_SIGNING_UNAVAILABLE',
    });
    expect(log.error).toHaveBeenCalledExactlyOnceWith({
      message: 'checkout shipping recovery signing unavailable',
      code: '42501',
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { message: 'private provider payload', code: 'XX000' },
  ])('returns a generic server failure for unclassified input %j', async (error) => {
    const response = recoveryFailure(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to recover this shipping quote. Please try again.',
    });
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'Checkout shipping recovery failed',
      { code: error?.code }
    );
    expect(log.error).not.toHaveBeenCalled();
  });
});
