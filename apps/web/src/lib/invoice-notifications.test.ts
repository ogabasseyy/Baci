import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyNewInvoice } from './invoice-notifications';

const { mockNotifyMerchant, mockPreference } = vi.hoisted(() => ({
  mockNotifyMerchant: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, errors: [] })
  ),
  mockPreference: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/lib/expo-push', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount}`,
  notifyMerchant: mockNotifyMerchant,
}));

vi.mock('@/lib/follow-up-notification-preferences', () => ({
  isFollowUpNotificationsEnabled: mockPreference,
}));

describe('notifyNewInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a follow-up message with the outstanding amount', async () => {
    const result = await notifyNewInvoice(
      'merchant-1',
      'order-1',
      'ORD-001',
      'Customer',
      9000,
      { currency: 'NGN', preferenceClient: {} as never }
    );

    expect(result).toEqual({ sent: 1, failed: 0, errors: [] });
    expect(mockPreference).toHaveBeenCalledWith({}, 'order-1');
    expect(mockNotifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '🧾 New Invoice',
      'Invoice #ORD-001 created by Customer for NGN 9000. Follow up with the customer to collect payment.',
      {
        type: 'new_invoice',
        order_id: 'order-1',
        order_number: 'ORD-001',
        amount: 9000,
        currency: 'NGN',
      },
      'orders'
    );
  });

  it('does not send when the merchant has disabled follow-up alerts', async () => {
    const preferenceClient = {} as never;
    mockPreference.mockResolvedValueOnce(false);

    await expect(
      notifyNewInvoice('merchant-1', 'order-1', 'ORD-001', 'Customer', 9000, {
        preferenceClient,
      })
    ).resolves.toEqual({ sent: 0, failed: 0, errors: [] });

    expect(mockPreference).toHaveBeenCalledWith(preferenceClient, 'order-1');
    expect(mockNotifyMerchant).not.toHaveBeenCalled();
  });
});
