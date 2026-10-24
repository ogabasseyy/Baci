import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCheckoutOrder } from './create-checkout-order';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiPost }));
const input: Parameters<typeof createCheckoutOrder>[0] = {
  merchantId: 'merchant',
  data: {
    firstName: 'Ada',
    lastName: 'Okon',
    email: 'ada@example.test',
    phone: '+2348031234567',
    address: '1 Test Road',
    city: 'Ikeja',
    state: 'Lagos',
  },
  orderItems: [],
  subtotal: 1000,
  finalShippingFee: 100,
  selectedGateway: 'paystack',
  shippingSessionId: 'session',
  selectedShippingQuote: {
    id: 'quote',
    provider: 'GIGL',
    carrierName: 'GIGL',
    serviceTier: 'standard',
    displayName: 'Delivery',
    estimatedDays: 2,
    price: 100,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
  },
  discountCode: 'SAVE',
  idempotencyKey: 'stable-key',
};
beforeEach(() => {
  apiPost.mockClear();
  apiPost.mockResolvedValue({ order: { id: 'order' } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
});
it.each([
  true,
  false,
])('submits consent-aware attribution with the generic checkout: %s', async (allowed) => {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue(
    'unrelated_promotion=20%off; __oppref=click; __obref=browser'
  );
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: allowed })
  );
  await createCheckoutOrder(input);
  expect(apiPost).toHaveBeenCalledWith(
    '/api/orders',
    expect.objectContaining({
      payment_status: 'unpaid',
      discount_code: 'SAVE',
      ad_tracking: allowed
        ? { chatgptConsent: true, oppref: 'click', obref: 'browser' }
        : { chatgptConsent: false },
    }),
    { headers: { 'Idempotency-Key': 'stable-key' } }
  );
});
it('reads consent again for a later submission', async () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  await createCheckoutOrder(input);
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: false })
  );
  await createCheckoutOrder(input);
  expect(apiPost.mock.calls[1]?.[1].ad_tracking.chatgptConsent).toBe(false);
});
