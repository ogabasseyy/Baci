import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { dispatchOrderCreationNotifications } from './order-notification-dispatch';

const { mockNotifyNewInvoice, mockNotifyNewOrder, mockNotifyPaymentReceived } =
  vi.hoisted(() => ({
    mockNotifyNewInvoice: vi.fn(() =>
      Promise.resolve({ sent: 1, failed: 0, errors: [] })
    ),
    mockNotifyNewOrder: vi.fn(() =>
      Promise.resolve({ sent: 1, failed: 0, errors: [] })
    ),
    mockNotifyPaymentReceived: vi.fn(() =>
      Promise.resolve({ sent: 1, failed: 0, errors: [] })
    ),
  }));

vi.mock('@/lib/expo-push', () => ({
  notifyNewInvoice: mockNotifyNewInvoice,
  notifyNewOrder: mockNotifyNewOrder,
  notifyPaymentReceived: mockNotifyPaymentReceived,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

function input(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: 'merchant-1',
    orderId: 'order-1',
    orderNumber: 'ORD-001',
    customerName: 'Customer',
    orderTotal: 15000,
    orderCurrency: 'NGN',
    paymentMethod: 'invoice',
    paymentStatus: 'unpaid',
    invoiceBalanceDue: 15000,
    isWalletFullyPaid: false,
    preferenceClient: {} as never,
    ...overrides,
  };
}

describe('dispatchOrderCreationNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches an unpaid invoice follow-up alert with the RLS preference client', async () => {
    const preferenceClient = {} as never;

    await dispatchOrderCreationNotifications(input({ preferenceClient }));

    expect(mockNotifyNewInvoice).toHaveBeenCalledWith(
      'merchant-1',
      'order-1',
      'ORD-001',
      'Customer',
      15000,
      { currency: 'NGN', preferenceClient }
    );
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
  });

  it('does not create a payment-collection alert when a discount leaves no balance', async () => {
    await dispatchOrderCreationNotifications(
      input({ orderTotal: 0, invoiceBalanceDue: 0 })
    );

    expect(mockNotifyNewInvoice).not.toHaveBeenCalled();
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
  });

  it('uses the outstanding invoice balance for a partial-credit follow-up alert', async () => {
    await dispatchOrderCreationNotifications(
      input({ orderTotal: 15000, invoiceBalanceDue: 9000 })
    );

    expect(mockNotifyNewInvoice).toHaveBeenCalledWith(
      'merchant-1',
      'order-1',
      'ORD-001',
      'Customer',
      9000,
      { currency: 'NGN', preferenceClient: expect.anything() }
    );
  });

  it('regression: skips the payment-collection alert when wallet settles the invoice', async () => {
    await dispatchOrderCreationNotifications(
      input({
        invoiceBalanceDue: 0,
        isWalletFullyPaid: true,
      })
    );

    expect(mockNotifyNewInvoice).not.toHaveBeenCalled();
    expect(mockNotifyPaymentReceived).toHaveBeenCalledWith(
      'merchant-1',
      15000,
      'NGN',
      'ORD-001',
      'order-1'
    );
  });

  it('keeps normal order notifications on the existing path', async () => {
    await dispatchOrderCreationNotifications(
      input({ paymentMethod: 'pay_on_delivery' })
    );

    expect(mockNotifyNewOrder).toHaveBeenCalledWith(
      'merchant-1',
      'order-1',
      'ORD-001',
      'Customer',
      15000,
      'NGN'
    );
    expect(mockNotifyNewInvoice).not.toHaveBeenCalled();
  });

  it('logs an invoice push failure and still sends the paid confirmation', async () => {
    const pushError = new Error('expo push unavailable');
    mockNotifyNewInvoice.mockRejectedValueOnce(pushError);

    await dispatchOrderCreationNotifications(
      input({ isWalletFullyPaid: true })
    );

    expect(logger.error).toHaveBeenCalledWith({
      message: 'Push notification failed',
      error: pushError,
    });
    expect(mockNotifyPaymentReceived).toHaveBeenCalledWith(
      'merchant-1',
      15000,
      'NGN',
      'ORD-001',
      'order-1'
    );
  });

  it('keeps the paid confirmation after a reachable paid-order push failure', async () => {
    const pushError = new Error('expo push unavailable');
    mockNotifyNewOrder.mockRejectedValueOnce(pushError);

    await dispatchOrderCreationNotifications(
      input({ paymentMethod: 'pay_on_delivery', isWalletFullyPaid: true })
    );

    expect(logger.error).toHaveBeenCalledWith({
      message: 'Push notification failed',
      error: pushError,
    });
    expect(mockNotifyPaymentReceived).toHaveBeenCalledWith(
      'merchant-1',
      15000,
      'NGN',
      'ORD-001',
      'order-1'
    );
  });
});
