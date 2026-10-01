import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { ...actual, ...shippingQuoteEnvTestMock };
});

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

vi.mock(
  '@/lib/shipping/order-shipment-booking-utils',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/shipping/order-shipment-booking-utils')
      >();
    return {
      ...actual,
      buildReceiver: vi.fn().mockReturnValue({
        name: 'Customer',
        phone: '08000000001',
        address: 'Receiver Road',
        city: 'Abuja',
        state: 'Abuja',
        country: 'Nigeria',
        countryCode: 'NG',
      }),
      toShipmentItems: vi
        .fn()
        .mockReturnValue([
          { name: 'Widget', quantity: 1, weight: 1, value: 5000 },
        ]),
    };
  }
);

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');
const {
  correctedSender,
  createSupabase,
  mismatchedCallerSender,
  stubShippingService,
} = await import('./book-order-shipment.refresh-fixtures.test-helper');

describe('bugfix: expired domestic quote refresh sender', () => {
  beforeEach(() => {
    stubShippingService();
  });

  it('refreshes expired domestic quotes with the server-resolved merchant sender', async () => {
    await bookOrderShipment(createSupabase(), 'merchant-1', 'order-1');

    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        shipmentType: 'domestic',
        sender: correctedSender,
      })
    );
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: correctedSender })
    );
  });

  it('does not book when persisting the refreshed quote fails', async () => {
    await expect(
      bookOrderShipment(
        createSupabase({ upsertError: { message: 'upsert failed' } }),
        'merchant-1',
        'order-1'
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'QUOTE_REFRESH_PERSIST_FAILED',
        status: 500,
      })
    );

    expect(shippingService.getProviderQuotes).toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('requires wallet quote reconfirmation instead of refreshing an expired quote', async () => {
    await expect(
      bookOrderShipment(
        createSupabase({ fundingSource: 'merchant_wallet' }),
        'merchant-1',
        'order-1'
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });

    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});

describe('bugfix: unexpired domestic quote sender mismatch', () => {
  beforeEach(() => {
    stubShippingService();
  });

  it('refreshes an unexpired quote when the stored sender differs from the registered merchant origin', async () => {
    await bookOrderShipment(
      createSupabase({
        quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        storedSender: mismatchedCallerSender,
      }),
      'merchant-1',
      'order-1'
    );

    expect(shippingService.getProviderQuotes).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        shipmentType: 'domestic',
        sender: correctedSender,
      })
    );
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: correctedSender })
    );
  });

  it('does not refresh an unexpired quote when the stored sender already matches', async () => {
    await bookOrderShipment(
      createSupabase({
        quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        storedSender: correctedSender,
      }),
      'merchant-1',
      'order-1'
    );

    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: correctedSender })
    );
  });

  it('books the original quote normally when a wallet quote is still fresh', async () => {
    await bookOrderShipment(
      createSupabase({
        quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        storedSender: correctedSender,
        fundingSource: 'merchant_wallet',
      }),
      'merchant-1',
      'order-1'
    );

    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ quoteId: 'quote-1' })
    );
  });

  it('requires wallet quote reconfirmation instead of refreshing a changed sender', async () => {
    await expect(
      bookOrderShipment(
        createSupabase({
          quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          storedSender: mismatchedCallerSender,
          fundingSource: 'merchant_wallet',
        }),
        'merchant-1',
        'order-1'
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });

    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
