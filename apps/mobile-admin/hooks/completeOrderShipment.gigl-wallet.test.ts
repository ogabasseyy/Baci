import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: vi.fn(),
  },
}));
vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://example.com',
}));

import { completeOrderShipment } from './completeOrderShipment';

describe('completeOrderShipment GIGL wallet cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
    });
  });

  it('invalidates the merchant wallet after an already-funded provider booking', async () => {
    const updateStatus = vi.fn().mockResolvedValue({});
    await completeOrderShipment({
      fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
      handleSaveRider: vi.fn(),
      mode: 'provider',
      merchantId: 'merchant-1',
      order: {
        id: 'order-1',
        amount_paid: 0,
        balance: 0,
        created_at: '',
        customer_email: 'customer@example.com',
        customer_name: 'Ada',
        customer_phone: null,
        discount_amount: 0,
        order_number: 'ORD-1',
        payment_status: 'pending',
        shipping_address: null,
        shipping_status: 'processing',
        total: 10000,
        updated_at: '',
      },
      providerBookingAvailable: true,
      providerLabel: 'GIG Logistics',
      queryClient: {
        invalidateQueries: mocks.invalidateQueries,
      } as unknown as QueryClient,
      riderPhone: '',
      saveDetails: false,
      updateStatus,
    });

    expect(updateStatus).toHaveBeenCalledWith({
      orderId: 'order-1',
      status: 'shipped',
    });
    expect(mocks.invalidateQueries).toHaveBeenNthCalledWith(5, {
      queryKey: ['merchant-wallet'],
    });
  });
});
