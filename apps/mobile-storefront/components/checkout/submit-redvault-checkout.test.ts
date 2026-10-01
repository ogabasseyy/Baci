import { persistPendingRedvaultOrder } from '@/lib/pending-redvault-order';
import { submitRedvaultCheckout } from './submit-redvault-checkout';

jest.mock('@/lib/pending-redvault-order', () => ({
  persistPendingRedvaultOrder: jest.fn(),
}));

const mockPersist = persistPendingRedvaultOrder as jest.Mock;

describe('submitRedvaultCheckout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists the fence before tracking and opening the review callback', async () => {
    const onRedvaultOrder = jest.fn();
    const onInitializationSuccess = jest.fn();
    const mockSaveTracking = jest.fn().mockResolvedValue(undefined);
    const orderResponse = { order: { id: 'order-1' } } as never;
    const trackingContext = { total: 1000 } as never;

    await submitRedvaultCheckout({
      checkoutGeneration: 'gen-1',
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
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        checkoutGeneration: 'gen-1',
      })
    );
    expect(mockPersist.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveTracking.mock.invocationCallOrder[0]
    );
    expect(onRedvaultOrder).toHaveBeenCalledWith({
      orderResponse,
      customerEmail: 'customer@example.com',
      customerName: 'Customer Name',
      customerPhone: '08000000000',
      onInitializationSuccess,
    });
  });

  it('persists the customer email so replays match the order snapshot', async () => {
    const onRedvaultOrder = jest.fn();
    const orderResponse = {
      order: { id: 'order-1', tracking_token: 'track-1' },
    } as never;

    await submitRedvaultCheckout({
      checkoutGeneration: 'gen-1',
      customerEmail: 'customer@example.com',
      customerName: 'Customer Name',
      customerPhone: '08000000000',
      onInitializationSuccess: jest.fn(),
      onRedvaultOrder,
      orderResponse,
      saveTracking: jest.fn().mockResolvedValue(undefined),
      trackingContext: { total: 1000 } as never,
    });

    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        customerEmail: 'customer@example.com',
      })
    );
  });

  it('persists the tracking token so guests can resolve the fence later', async () => {
    const onRedvaultOrder = jest.fn();
    const orderResponse = {
      order: { id: 'order-1', tracking_token: 'track-1' },
    } as never;

    await submitRedvaultCheckout({
      checkoutGeneration: 'gen-1',
      customerEmail: 'customer@example.com',
      customerName: 'Customer Name',
      customerPhone: '08000000000',
      onInitializationSuccess: jest.fn(),
      onRedvaultOrder,
      orderResponse,
      saveTracking: jest.fn().mockResolvedValue(undefined),
      trackingContext: { total: 1000 } as never,
    });

    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        trackingToken: 'track-1',
      })
    );
  });
});
