import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, mockAnalytics } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockAnalytics: {
    viewItem: vi.fn(),
    addToCart: vi.fn(),
    beginCheckout: vi.fn(),
  },
}));

vi.mock('@/lib/analytics/send-tracked-event', () => ({
  sendTrackedEvent: mockSend,
}));
vi.mock('@/lib/analytics', () => ({ analytics: mockAnalytics }));

import { trackEvent } from './event-tracking';

const product = {
  id: 'prod-1',
  name: 'iPhone 15',
  price: 900_000,
  category: 'Phones',
};

describe('trackEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends add_to_cart to Baci and the pixels with one shared event id', () => {
    trackEvent.addToCart('merchant-1', product, 2, 'NGN');

    expect(mockSend).toHaveBeenCalledWith({
      event_id: expect.any(String),
      event_type: 'add_to_cart',
      merchant_id: 'merchant-1',
      product_id: 'prod-1',
      product_name: 'iPhone 15',
      product_category: 'Phones',
      product_price: 900_000,
      quantity: 2,
      currency: 'NGN',
    });
    const eventId = mockSend.mock.calls[0][0].event_id;
    expect(mockAnalytics.addToCart).toHaveBeenCalledWith(
      product,
      2,
      'NGN',
      undefined,
      eventId
    );
  });

  it('prefers the joined category name for product_view', () => {
    trackEvent.productView(
      'merchant-1',
      { ...product, categories: { id: 'c1', name: 'Smartphones' } as never },
      'NGN'
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'product_view',
        product_category: 'Smartphones',
      })
    );
    expect(mockAnalytics.viewItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prod-1' }),
      'NGN',
      mockSend.mock.calls[0][0].event_id
    );
  });

  it('totals begin_checkout lines and item count', () => {
    trackEvent.beginCheckout(
      'merchant-1',
      [
        { product, quantity: 1 },
        { product: { ...product, id: 'prod-2', price: 10_000 }, quantity: 3 },
      ],
      'NGN'
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'begin_checkout',
        total: 930_000,
        subtotal: 930_000,
        item_count: 4,
      })
    );
    expect(mockAnalytics.beginCheckout).toHaveBeenCalledOnce();
  });
});
