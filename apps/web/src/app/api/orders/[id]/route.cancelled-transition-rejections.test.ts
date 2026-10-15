import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  getMerchantIdForApiUser: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyOrderStatusChange: vi.fn(),
}));

vi.mock('@/lib/insurance/notify-activate-protection', () => ({
  maybeNotifyActivateProtection: vi.fn(),
}));

vi.mock('@/lib/order-queries', () => ({
  ORDER_COLUMNS: 'id, shipping_status, shipping_provider, tracking_number',
  ORDER_WITH_ITEMS_QUERY: 'id',
}));

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => ({
  ensurePaidOrderInventoryConfirmed: vi.fn(),
  isSerializedInventoryUnavailableError: () => false,
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
  SerializedInventoryUnavailableError: class extends Error {},
}));

vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview: vi.fn(),
}));

vi.mock('@/lib/shipping/run-claimed-order-wallet-or-checkout-booking', () => ({
  runClaimedOrderWalletOrCheckoutBooking: vi.fn(),
}));

vi.mock('@/lib/shipping/load-order-gigl-settled-retained-amount', () => ({
  loadOrderGiglSettledRetainedAmount: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  claimOrderShipmentBooking: vi.fn(),
  clearOrderShipmentBookingLock: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-utils', () => ({
  isShippingProviderCode: (value: string | null | undefined) =>
    value === 'TOPSHIP' || value === 'GIGL' || value === 'SHIIP',
  OrderShipmentBookingError: class extends Error {},
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { rollbackOrderStatusAfterInventoryConfirmationFailure } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { PATCH } from './route';
import {
  createCancelledTransitionHarness,
  createMockUser,
  createPatchRequest,
  setupCancelledTransitionMocks,
} from './route.cancelled-transition.test-support';

describe('PATCH /api/orders/[id] cancelled-transition rejections', () => {
  beforeEach(() => {
    setupCancelledTransitionMocks();
  });

  it('rejects marking a payment-cancelled order as paid', async () => {
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'pending',
        payment_status: 'cancelled',
        is_credit_order: false,
        customer_id: null,
        selected_quote_id: null,
        shipping_provider: null,
        tracking_number: null,
        shipment_id: null,
      },
      {
        id: 'order-1',
        shipping_status: 'pending',
        shipping_provider: null,
        tracking_number: null,
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ payment_status: 'paid' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('rejects moving a payment-cancelled order back to pending', async () => {
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'pending',
        payment_status: 'cancelled',
        is_credit_order: false,
        customer_id: null,
        selected_quote_id: null,
        shipping_provider: null,
        tracking_number: null,
        shipment_id: null,
      },
      {
        id: 'order-1',
        shipping_status: 'pending',
        shipping_provider: null,
        tracking_number: null,
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ payment_status: 'pending' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('rejects moving a shipping-cancelled order back to pending', async () => {
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'cancelled',
        payment_status: 'paid',
        is_credit_order: false,
        customer_id: null,
        selected_quote_id: null,
        shipping_provider: null,
        tracking_number: null,
        shipment_id: null,
      },
      {
        id: 'order-1',
        shipping_status: 'cancelled',
        shipping_provider: null,
        tracking_number: null,
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'pending' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SHIPPING_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });
});
