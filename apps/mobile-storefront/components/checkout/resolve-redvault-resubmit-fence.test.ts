import { Alert } from 'react-native';
import {
  clearPersistedRedvaultOrder,
  readPersistedRedvaultOrder,
  resolvePersistedRedvaultOrder,
} from '@/lib/pending-redvault-order';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';
import { cancelRedvaultOrder } from './cancel-redvault-order';
import {
  initializeRedvaultCheckoutById,
  RedvaultInitializationError,
} from './redvault/initialize-redvault-checkout';
import {
  fetchFencedRedvaultOrderState,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';
import { resolveRedvaultFenceForResubmit } from './resolve-redvault-resubmit-fence';

jest.mock('@/lib/pending-redvault-order', () => ({
  clearPersistedRedvaultOrder: jest.fn(),
  readPersistedRedvaultOrder: jest.fn(),
  resolvePersistedRedvaultOrder: jest.fn(),
}));
jest.mock('./cancel-redvault-order', () => ({
  cancelRedvaultOrder: jest.fn(),
}));
jest.mock('./resolve-checkout-redvault-fence', () => ({
  fetchFencedRedvaultOrderState: jest.fn(),
  routeToPaidFenceOrder: jest.fn(),
}));
jest.mock('./attach-redvault-guest-order', () => ({
  attachRedvaultGuestOrderAfterSignup: jest.fn(),
}));
jest.mock('./redvault/initialize-redvault-checkout', () => ({
  initializeRedvaultCheckoutById: jest.fn(),
  RedvaultInitializationError: jest.fn(),
}));
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

const mockRead = readPersistedRedvaultOrder as jest.Mock;
const mockResolve = resolvePersistedRedvaultOrder as jest.Mock;
const mockClear = clearPersistedRedvaultOrder as jest.Mock;
const mockCancel = cancelRedvaultOrder as jest.Mock;
const mockAttach = attachRedvaultGuestOrderAfterSignup as jest.Mock;
const mockRoutePaid = routeToPaidFenceOrder as jest.Mock;
const mockInitById = initializeRedvaultCheckoutById as jest.Mock;
const mockAlert = Alert.alert as jest.Mock;

const RECORD = {
  orderId: 'order-rv',
  checkoutGeneration: 'gen-0',
  createdAt: '2026-09-20T00:00:00.000Z',
  trackingToken: 'track-rv',
};

const INPUT = {
  attemptGuestAttach: false,
  clearCart: jest.fn(),
  customerEmail: 'customer@example.com',
  customerName: 'Ada Okafor',
  customerPhone: '08012345678',
  onInitializationSuccess: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchFencedRedvaultOrderState as jest.Mock).mockResolvedValue({
    id: 'order-rv',
    total: 1201500,
    payment_status: 'unpaid',
    shipping_status: 'pending',
  });
});

describe('resolveRedvaultFenceForResubmit', () => {
  it('proceeds when no fence is persisted', async () => {
    mockRead.mockResolvedValue(null);

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'proceed'
    );
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('routes a paid fence to the completed order', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockImplementation(async ({ validateOrder }: any) => {
      await validateOrder('order-rv');
      return { blocked: false, paidOrderId: 'order-rv' };
    });

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockRoutePaid).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-rv' })
    );
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('recreates once the fenced order is terminal', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: false });

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'proceed'
    );
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('cancels an unresolved fence and recreates', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('cancelled');

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'proceed'
    );
    expect(mockCancel).toHaveBeenCalledWith({
      orderId: 'order-rv',
      reason: expect.any(String),
      trackingToken: 'track-rv',
    });
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('replays a live fenced checkout instead of duplicating', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    mockInitById.mockResolvedValue('ready');

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockInitById).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-rv' })
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'UBA payment in progress',
      expect.stringMatching(/original order/i)
    );
  });

  it('explains a definitive replay failure without duplicating', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    const definitive = new (RedvaultInitializationError as any)('no');
    definitive.kind = 'definitive';
    mockInitById.mockRejectedValue(definitive);

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to continue payment',
      expect.any(String)
    );
  });

  it('holds the replay when initialization stays pending', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    mockInitById.mockResolvedValue('pending');

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Payment still processing',
      expect.stringMatching(/Do not pay again/i)
    );
  });

  it('attaches the replayed order after guest side effects complete', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    const onInitializationSuccess = jest.fn(async () => undefined);
    mockInitById.mockImplementation(async ({ onReady }: any) => {
      await onReady();
      return 'ready';
    });

    await expect(
      resolveRedvaultFenceForResubmit({
        ...INPUT,
        attemptGuestAttach: true,
        onInitializationSuccess,
      })
    ).resolves.toBe('handled');
    // Crash recovery attaches before the replay; the fresh signup attaches
    // again after its side effects. Both are idempotent.
    expect(mockAttach).toHaveBeenCalledTimes(2);
    expect(mockAttach).toHaveBeenNthCalledWith(1, {
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });
    expect(mockAttach).toHaveBeenNthCalledWith(2, {
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });
    const attachOrder = mockAttach.mock.invocationCallOrder;
    expect(onInitializationSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      attachOrder[attachOrder.length - 1]
    );
  });

  it('attaches before replaying so an interrupted signup cannot strand the checkout', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    mockInitById.mockResolvedValue('ready');

    await expect(
      resolveRedvaultFenceForResubmit({ ...INPUT, attemptGuestAttach: false })
    ).resolves.toBe('handled');
    expect(mockAttach).toHaveBeenCalledWith({
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });
    expect(mockAttach.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitById.mock.invocationCallOrder[0]
    );
  });

  it('replays with the persisted email when the form email changed', async () => {
    mockRead.mockResolvedValue({
      ...RECORD,
      customerEmail: 'original@example.com',
    });
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    mockInitById.mockResolvedValue('ready');

    await expect(
      resolveRedvaultFenceForResubmit({
        ...INPUT,
        customerEmail: 'edited@example.com',
      })
    ).resolves.toBe('handled');
    expect(mockInitById).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-rv',
        customerEmail: 'original@example.com',
      })
    );
  });

  it('falls back to the form email for legacy records without one', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('live');
    mockInitById.mockResolvedValue('ready');

    await expect(
      resolveRedvaultFenceForResubmit({
        ...INPUT,
        customerEmail: 'edited@example.com',
      })
    ).resolves.toBe('handled');
    expect(mockInitById).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-rv',
        customerEmail: 'edited@example.com',
      })
    );
  });

  it('blocks when the previous order cannot be released', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });
    mockCancel.mockResolvedValue('failed');

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to release previous order',
      expect.any(String)
    );
  });

  it('blocks when fence validation throws', async () => {
    mockRead.mockResolvedValue(RECORD);
    mockResolve.mockRejectedValue(new Error('network down'));

    await expect(resolveRedvaultFenceForResubmit(INPUT)).resolves.toBe(
      'handled'
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to verify pending payment',
      expect.any(String)
    );
  });
});
