import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateRepairShipping } from './repair';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  ensureActionRateLimit: vi.fn(),
  getMerchantByIdentifier: vi.fn(),
  getQuotes: vi.fn(),
  getRepairCenterAddress: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: mocks.getMerchantByIdentifier,
}));

vi.mock('@/lib/repairs/repair-center-address', () => ({
  getRepairCenterAddress: mocks.getRepairCenterAddress,
}));

vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: mocks.getQuotes,
  },
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
// Shipping estimates take the PUBLIC storefront identifier, not the raw UUID.
const merchantSlug = 'ogabassey';

describe('calculateRepairShipping', () => {
  const validPlace = {
    streetNumber: '12',
    route: 'Aba Road',
    city: 'Port Harcourt',
    state: 'Rivers',
    zip: '500001',
    country: 'Nigeria',
    formattedAddress: '12 Aba Road, Port Harcourt, Rivers, Nigeria',
  };

  const lagosRepairCenter = {
    name: 'Ogabassey Repair Center',
    phone: '09070007000',
    email: 'repairs@ogabassey.com',
    address: '3 Olayeni Street, Computer Village',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
    mocks.createClient.mockResolvedValue({ client: 'supabase' });
    mocks.getMerchantByIdentifier.mockResolvedValue({
      id: merchantId,
      is_published: true,
    });
    mocks.getRepairCenterAddress.mockResolvedValue(lagosRepairCenter);
  });

  it('returns a rate-limit error without requesting GIGL quotes', async () => {
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);

    const result = await calculateRepairShipping(validPlace, merchantSlug);

    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith(
      'repair-shipping',
      { requests: 10, windowMs: 60_000 }
    );
    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Too many shipping estimates. Please try again shortly.',
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it('rejects invalid place details without requesting GIGL quotes', async () => {
    const result = await calculateRepairShipping(
      { ...validPlace, formattedAddress: 'a'.repeat(501) },
      merchantSlug
    );

    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Invalid address details',
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it('rejects incomplete place details without requesting GIGL quotes', async () => {
    const result = await calculateRepairShipping(
      { ...validPlace, city: '', state: '' },
      merchantSlug
    );

    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Invalid address details',
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it('degrades to drop-off without reading private settings for an unknown storefront', async () => {
    mocks.getMerchantByIdentifier.mockResolvedValueOnce(null);

    const result = await calculateRepairShipping(validPlace, merchantSlug);

    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Arranged after booking',
      message: 'Drop-off only — the store will contact you to arrange pickup.',
    });
    expect(mocks.getRepairCenterAddress).not.toHaveBeenCalled();
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it('degrades to drop-off identically for an unpublished storefront', async () => {
    mocks.getMerchantByIdentifier.mockResolvedValueOnce({
      id: merchantId,
      is_published: false,
    });

    const result = await calculateRepairShipping(validPlace, merchantSlug);

    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Arranged after booking',
      message: 'Drop-off only — the store will contact you to arrange pickup.',
    });
    expect(mocks.getRepairCenterAddress).not.toHaveBeenCalled();
  });

  it('falls back to drop-off only when the repair center is not configured', async () => {
    mocks.getRepairCenterAddress.mockResolvedValueOnce(null);

    const result = await calculateRepairShipping(validPlace, merchantSlug);

    expect(result).toEqual({
      isFree: false,
      price: 0,
      formattedPrice: 'Arranged after booking',
      message: 'Drop-off only — the store will contact you to arrange pickup.',
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it('quotes GIGL pickup even when the customer is in the repair center state', async () => {
    mocks.getQuotes.mockResolvedValueOnce([
      { price: 2500, isStationPickup: false },
    ]);

    const result = await calculateRepairShipping(
      {
        ...validPlace,
        city: 'Ikeja',
        state: 'Lagos',
        formattedAddress: '3 Olayeni Street, Ikeja, Lagos, Nigeria',
      },
      merchantSlug
    );

    expect(result).toEqual({
      isFree: false,
      price: 2500,
      formattedPrice: '₦2,500',
      message: 'Estimated pickup fee: ₦2,500',
    });
    expect(mocks.getQuotes).toHaveBeenCalledOnce();
  });

  it('quotes GIGL doorstep collection for out-of-state addresses', async () => {
    mocks.getQuotes.mockResolvedValueOnce([
      { price: 5000 },
      { price: 3000 },
      { price: 0 },
    ]);

    const result = await calculateRepairShipping(validPlace, merchantSlug);

    expect(result.isFree).toBe(false);
    expect(result.price).toBe(3000);
    expect(result.error).toBeUndefined();
    expect(mocks.getQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        receiver: expect.objectContaining({ state: 'Lagos', city: 'Ikeja' }),
        sender: expect.objectContaining({ state: 'Rivers' }),
      })
    );
  });

  it('falls back to a friendly error when quoting fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getQuotes.mockRejectedValueOnce(new Error('gigl down'));

    try {
      const result = await calculateRepairShipping(validPlace, merchantSlug);

      expect(result).toEqual({
        isFree: false,
        price: 0,
        formattedPrice: 'Calculated at confirmation',
        error: 'Failed to calculate shipping',
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
