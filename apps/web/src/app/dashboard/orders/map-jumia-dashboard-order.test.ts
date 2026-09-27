import { describe, expect, it } from 'vitest';
import type { JumiaOrder } from './map-jumia-dashboard-order';
import { mapJumiaDashboardOrder } from './map-jumia-dashboard-order';

function jumiaOrder(overrides: Partial<JumiaOrder> = {}): JumiaOrder {
  return {
    jumia_order_id: 'J-1',
    jumia_order_number: '1001',
    jumia_shop_id: 'shop-1',
    marketplace_key: 'NG-main',
    customer_name: 'Adaeze Obi',
    total_amount: '5000',
    status: 'pending',
    created_at_jumia: '2026-09-01T10:00:00.000Z',
    items: [],
    ...overrides,
  };
}

describe('mapJumiaDashboardOrder', () => {
  it('retains the provider identity needed for fulfillment resolution', () => {
    const mapped = mapJumiaDashboardOrder(jumiaOrder());

    expect(mapped).toMatchObject({
      id: 'J-1',
      orderNumber: '1001',
      jumiaShopId: 'shop-1',
      jumiaMarketplaceKey: 'NG-main',
      jumiaOrderId: 'J-1',
      customerName: 'Adaeze Obi',
      total: 5000,
      currency: null,
      source: 'jumia',
      shippingStatus: 'Pending',
      paymentStatus: 'Paid',
    });
  });

  it('passes through the stored currency and preserves a missing value as null', () => {
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ currency: 'DZD' })).currency
    ).toBe('DZD');
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ currency: '  ' })).currency
    ).toBeNull();
    expect(mapJumiaDashboardOrder(jumiaOrder()).currency).toBeNull();
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ currency: null })).currency
    ).toBeNull();
  });

  it('maps canceled and failed Jumia statuses', () => {
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ status: 'canceled' }))
    ).toMatchObject({ shippingStatus: 'Canceled', paymentStatus: 'Refunded' });
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ status: 'Shipped' }))
    ).toMatchObject({ shippingStatus: 'Shipped', paymentStatus: 'Paid' });
    expect(
      mapJumiaDashboardOrder(jumiaOrder({ status: 'FAILED' }))
    ).toMatchObject({ shippingStatus: 'Canceled' });
  });

  it('falls back to defaults for missing identity and items', () => {
    const mapped = mapJumiaDashboardOrder(
      jumiaOrder({
        jumia_shop_id: null,
        marketplace_key: null,
        customer_name: null,
        items: undefined,
      })
    );

    expect(mapped.jumiaShopId).toBeUndefined();
    expect(mapped.jumiaMarketplaceKey).toBeUndefined();
    expect(mapped.customerName).toBe('Jumia Customer');
    expect(mapped.items).toEqual([]);
  });
});
