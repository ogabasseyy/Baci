import { submitRedvaultCheckout } from './submit-redvault-checkout';

describe('submitRedvaultCheckout', () => {
  it('persists tracking before opening the review callback', async () => {
    const onRedvaultOrder = jest.fn();
    const onInitializationSuccess = jest.fn();
    const mockSaveTracking = jest.fn().mockResolvedValue(undefined);
    const orderResponse = { order: { id: 'order-1' } } as never;
    const trackingContext = { total: 1000 } as never;

    await submitRedvaultCheckout({
      customerEmail: 'customer@example.com',
      customerName: 'Customer Name',
      customerPhone: '08000000000',
      onInitializationSuccess,
      onRedvaultOrder,
      orderResponse,
      saveTracking: mockSaveTracking,
      trackingContext,
    });

    expect(mockSaveTracking).toHaveBeenCalledWith('order-1', trackingContext);
    expect(onRedvaultOrder).toHaveBeenCalledWith({
      orderResponse,
      customerEmail: 'customer@example.com',
      customerName: 'Customer Name',
      customerPhone: '08000000000',
      onInitializationSuccess,
    });
  });
});
