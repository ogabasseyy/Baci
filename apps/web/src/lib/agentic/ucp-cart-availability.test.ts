import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';
import { checkUcpCartAvailability } from './ucp-cart-availability';

vi.mock('./is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

describe('checkUcpCartAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a merchant enrolled in shared cart', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(true);
    await expect(checkUcpCartAvailability('merchant-1')).resolves.toEqual({
      ok: true,
    });
  });

  it('answers 404 cart_unavailable for a merchant not enrolled', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(false);

    const result = await checkUcpCartAvailability('merchant-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(404);
    await expect(result.response.json()).resolves.toEqual({
      code: 'cart_unavailable',
      error: 'Cart transfer is not available for this store',
    });
  });

  it('answers 503 when enrollment cannot be read', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockRejectedValue(
      new Error('Merchant unavailable')
    );

    const result = await checkUcpCartAvailability('merchant-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      code: 'cart_availability_unknown',
      error: 'Cart availability could not be checked',
    });
  });
});
