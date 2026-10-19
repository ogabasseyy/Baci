import { describe, expect, it, vi } from 'vitest';
import { dispatchOrderCreationNotifications } from '@/lib/order-notification-dispatch';
import { queueMerchantOrderNotifications } from './merchant-notifications';

vi.mock('next/server', () => ({
  after: (callback: () => void) => callback(),
}));

vi.mock('@/lib/order-notification-dispatch', () => ({
  dispatchOrderCreationNotifications: vi.fn(),
}));

const mockedDispatch = vi.mocked(dispatchOrderCreationNotifications);

describe('queueMerchantOrderNotifications', () => {
  it('forwards the merchant context to the creation dispatch', () => {
    queueMerchantOrderNotifications({
      supabase: { from: vi.fn() } as never,
      merchantId: 'merchant-1',
      orderId: 'order-1',
      orderNumber: 'BAC-1',
      customerName: 'Ada Buyer',
      orderTotal: 5000,
      orderCurrency: 'NGN',
      paymentMethod: 'paystack',
      paymentStatus: 'paid',
      invoiceBalanceDue: 0,
      isWalletFullyPaid: false,
    });

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        orderNumber: 'BAC-1',
        orderTotal: 5000,
        orderCurrency: 'NGN',
      })
    );
  });
});
