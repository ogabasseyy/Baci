import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';

type EnvModule = typeof import('@/env');
type OrderShipmentBookingUtilsModule =
  typeof import('@/lib/shipping/order-shipment-booking-utils');

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<EnvModule>();
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
    const actual = await importOriginal<OrderShipmentBookingUtilsModule>();
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

  it('requires confirmation when the expired quote has a changed merchant origin', async () => {
    await expect(
      bookOrderShipment(createSupabase(), 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
      status: 409,
    });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('does not persist a replacement for an unchanged expired paid quote', async () => {
    const client = createSupabase({
      storedSender: correctedSender,
      upsertError: { message: 'must not be called' },
    });
    await expect(
      bookOrderShipment(client, 'merchant-1', 'order-1')
    ).resolves.toMatchObject({ quoteId: 'quote-1' });
    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
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

  it('requires confirmation when an unexpired quote origin has changed', async () => {
    await expect(
      bookOrderShipment(
        createSupabase({
          quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          storedSender: mismatchedCallerSender,
        }),
        'merchant-1',
        'order-1'
      )
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' });
    expect(shippingService.getProviderQuotes).not.toHaveBeenCalled();
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('checks the price and reuses an unexpired quote when the stored sender matches', async () => {
    await bookOrderShipment(
      createSupabase({
        quoteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        storedSender: correctedSender,
      }),
      'merchant-1',
      'order-1'
    );

    expect(shippingService.getProviderQuotes).toHaveBeenCalledOnce();
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
