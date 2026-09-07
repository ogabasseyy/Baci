import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mocks,
  receiver,
  setup,
  subject,
} from './admin-order-gigl-quote.test-support';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  getUserAccess: mocks.getUserAccess,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: mocks.persistAdminGiglQuote,
}));
vi.mock('@/lib/shipping/build-order-gigl-quote-request', () => ({
  buildOrderGiglQuoteRequest: mocks.buildOrderGiglQuoteRequest,
}));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.resolveBookingMerchantSender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class MockShippingService {
    getProviderQuotes(...args: unknown[]) {
      return mocks.getProviderQuotes(...args);
    }
  },
}));

describe('Admin GIGL merchant eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it('rejects non-Nigerian merchants before privileged or provider use', async () => {
    setup({ merchant: { country: 'GH', payout_currency: 'GHS' } });
    const response = await subject({ receiver });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'GIGL_MERCHANT_INELIGIBLE',
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('rejects non-NGN payout currency even for Nigeria', async () => {
    setup({ merchant: { country: 'NG', payout_currency: 'USD' } });
    const response = await subject({ receiver });
    expect(response.status).toBe(422);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    '   ',
  ])('treats a missing or blank country value %j as Nigeria for NGN merchants', async (country) => {
    setup({ merchant: { country, payout_currency: 'NGN' } });
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(mocks.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.any(Object)
    );
  });

  it('fails closed when GIGL is not enabled for the merchant', async () => {
    setup({ featureSettings: { shipping_providers: ['topship'] } });
    const response = await subject({ receiver });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'GIGL_PROVIDER_DISABLED',
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('fails closed when provider settings cannot be loaded', async () => {
    setup({ featureError: { message: 'database unavailable' } });
    const response = await subject({ receiver });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Failed to resolve merchant eligibility',
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('continues to quote for eligible merchants with GIGL enabled', async () => {
    const response = await subject({ receiver });
    expect(response.status).toBe(200);
    expect(mocks.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.any(Object)
    );
  });
});
