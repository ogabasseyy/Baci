import { resolvePendingOrdersRoute } from './resolve-pending-orders-route';

describe('resolvePendingOrdersRoute', () => {
  it('routes signed-in shoppers to the order details view', () => {
    expect(
      resolvePendingOrdersRoute({
        customerId: 'customer-1',
        orderId: 'order-1',
        trackingToken: 'track-1',
        userId: 'user-1',
      })
    ).toBe('/orders/order-1');
  });

  it('routes signed-in shoppers without an order to the order list', () => {
    expect(
      resolvePendingOrdersRoute({
        customerId: 'customer-1',
        orderId: undefined,
        trackingToken: undefined,
        userId: 'user-1',
      })
    ).toBe('/orders');
  });

  it('routes guests with a tracking token to the guest status view', () => {
    expect(
      resolvePendingOrdersRoute({
        customerId: undefined,
        orderId: 'order-1',
        trackingToken: 'track-1',
        userId: undefined,
      })
    ).toEqual({
      pathname: '/track-order',
      params: { trackingToken: 'track-1' },
    });
  });

  it('falls back to the order list for guests without a token', () => {
    expect(
      resolvePendingOrdersRoute({
        customerId: undefined,
        orderId: 'order-1',
        trackingToken: undefined,
        userId: undefined,
      })
    ).toBe('/orders');
  });
});
