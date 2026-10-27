import { beforeEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { prepareSharedCartCheckout } from './shared-cart-checkout-client';
import {
  markCartDeviceRevocationPending,
  resetPendingCartDeviceRevocationsForTests,
} from './shared-cart-session-revoke-client';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPendingCartDeviceRevocationsForTests();
});
it('does not prepare checkout while durable device revocation remains pending', async () => {
  markCartDeviceRevocationPending('shop');
  vi.mocked(fetchWithCsrf).mockResolvedValue(
    Response.json({ code: 'temporarily_unavailable' }, { status: 503 })
  );
  const result = await prepareSharedCartCheckout(
    { cartId: 'old-cart', expectedVersion: 1, operationId: 'prepare' },
    'shop'
  );
  expect(result).toMatchObject({ ok: false, code: 'temporarily_unavailable' });
  expect(fetchWithCsrf).toHaveBeenCalledOnce();
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    expect.stringContaining('/revoke'),
    expect.anything()
  );
});
