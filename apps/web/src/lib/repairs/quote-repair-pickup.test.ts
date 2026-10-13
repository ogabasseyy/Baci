import { beforeEach, describe, expect, it, vi } from 'vitest';
import { quoteRepairPickup } from './quote-repair-pickup';

const getProviderQuotes = vi.hoisted(() => vi.fn());

vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes },
}));

const sender = {
  name: 'Customer',
  phone: '08000000000',
  address: '14 Testing Close, Osogbo',
  city: 'Osogbo',
  state: 'Osun',
  country: 'Nigeria',
  countryCode: 'NG',
};

const receiver = {
  name: 'Repair Center',
  phone: '09000000000',
  address: '2 Repair Street',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('quoteRepairPickup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('propagates a GIGL quote failure for the booking boundary to handle', async () => {
    getProviderQuotes.mockRejectedValueOnce(new Error('GIGL unavailable'));

    await expect(
      quoteRepairPickup({
        items: [{ name: 'Phone', quantity: 1, weight: 1, value: 50_000 }],
        merchantId: 'merchant-1',
        receiver,
        sender,
      })
    ).rejects.toThrow('GIGL unavailable');
  });

  it('requests GIGL and returns a doorstep quote', async () => {
    getProviderQuotes.mockResolvedValueOnce([
      {
        id: 'q-1',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics - GoStandard',
        estimatedDays: 3,
        price: 4500,
        currency: 'NGN',
        pickupIncluded: true,
        insuranceIncluded: false,
        expiresAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ]);

    const result = await quoteRepairPickup({
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 50_000 }],
      merchantId: 'merchant-1',
      receiver,
      sender,
    });

    expect(result.quote?.price).toBe(4500);
    expect(getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender, shipmentType: 'domestic' })
    );
  });
});
