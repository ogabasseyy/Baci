import { expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutRouteFixture } from '../primary-wallet-card-checkout-route.test-fixture';
import { POST } from './route';

const handle = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
);
vi.mock('../primary-wallet-card-checkout-route', () => ({
  handlePrimaryWalletCardCheckout: handle,
}));
it('uses the authenticated CSRF status boundary', async () => {
  const request = primaryWalletCardCheckoutRouteFixture('status').request();
  expect((await POST(request)).status).toBe(401);
  expect(handle).toHaveBeenCalledWith(request, 'status');
});
