import type { SupabaseClient } from '@supabase/supabase-js';
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

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => {
  class MockSerializedInventoryUnavailableError extends Error {
    constructor() {
      super('serialized_inventory_unavailable');
      this.name = 'SerializedInventoryUnavailableError';
    }
  }

  return {
    ensurePaidOrderInventoryConfirmed: vi.fn(),
    isSerializedInventoryUnavailableError: (error: unknown) =>
      error instanceof MockSerializedInventoryUnavailableError,
    rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
    SerializedInventoryUnavailableError:
      MockSerializedInventoryUnavailableError,
  };
});

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

vi.mock('@/lib/shipping/order-shipment-booking-utils', () => {
  class MockOrderShipmentBookingError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: {
      availableBalance: number;
      chargedAmount: number;
      shortfall: number;
    };

    constructor(
      message: string,
      status: number,
      code: string,
      _providerReference?: string,
      details?: {
        availableBalance: number;
        chargedAmount: number;
        shortfall: number;
      }
    ) {
      super(message);
      this.name = 'OrderShipmentBookingError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  return {
    isShippingProviderCode: vi.fn(
      (value: string | null | undefined) =>
        value === 'TOPSHIP' || value === 'GIGL' || value === 'SHIIP'
    ),
    OrderShipmentBookingError: MockOrderShipmentBookingError,
  };
});

import { authenticateApiRequest } from '@/lib/api-auth';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from '@/lib/shipping/order-shipment-booking-lock';
import { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';
import { PATCH } from './route';
import {
  createCancelledTransitionHarness,
  createMockUser,
  createPatchRequest,
  type ExistingOrderFixture,
  setupCancelledTransitionMocks,
  type UpdatedOrderFixture,
} from './route.cancelled-transition.test-support';

/** The harness rejects unknown tables, so capture failure-row inserts here. */
function captureFailureRows(supabase: SupabaseClient): unknown[] {
  const rows: unknown[] = [];
  const baseFrom = supabase.from.bind(supabase);
  (supabase as unknown as { from: unknown }).from = vi.fn((table: string) =>
    table === 'order_shipment_booking_failures'
      ? {
          insert: vi.fn(async (row: unknown) => {
            rows.push(row);
            return { error: null };
          }),
        }
      : baseFrom(table)
  );
  return rows;
}

describe('PATCH shipped: booking failure responses and lock state', () => {
  beforeEach(() => {
    setupCancelledTransitionMocks();
  });

  it('bugfix: pauses the order with a clear 503 when GIG does not answer in time', async () => {
    const existingOrder: ExistingOrderFixture = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrderFixture = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      existingOrder,
      updatedOrder
    );
    const failureRows = captureFailureRows(supabase);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // Silence expected error logging for this assertion.
      });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockRejectedValue(
      new Error('GIGL booking timed out')
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(claimOrderShipmentBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
      }),
      expect.any(Object)
    );
    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ code: 'SHIPMENT_BOOKING_UNCONFIRMED' });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();
    expect(failureRows).toEqual([
      expect.objectContaining({
        outcome: 'provider_unconfirmed',
        lock_retained: true,
      }),
    ]);

    consoleErrorSpy.mockRestore();
  });

  it('bugfix: releases the lock and answers 503 when GIG cannot be reached at all', async () => {
    const existingOrder: ExistingOrderFixture = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrderFixture = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      existingOrder,
      updatedOrder
    );
    const failureRows = captureFailureRows(supabase);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // Silence expected error logging for this assertion.
      });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockRejectedValue(
      Object.assign(new Error('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      })
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(claimOrderShipmentBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
      }),
      expect.any(Object)
    );
    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ code: 'PROVIDER_UNREACHABLE' });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(clearOrderShipmentBookingLock).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      'lock-1'
    );
    expect(failureRows).toEqual([
      expect.objectContaining({
        outcome: 'not_submitted',
        lock_retained: false,
      }),
    ]);

    consoleErrorSpy.mockRestore();
  });

  it('records lock_retained false when wallet booking already released the lock before throwing', async () => {
    const existingOrder: ExistingOrderFixture = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrderFixture = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'GIGL',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createCancelledTransitionHarness(
      existingOrder,
      updatedOrder
    );
    const failureRows = captureFailureRows(supabase);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // Silence expected error logging for this assertion.
      });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockImplementationOnce(
      async (_supabase, _merchantId, _orderId, _order, options) => {
        options?.onLockReleased?.();
        throw new Error('MERCHANT_WALLET_SUBMISSION_FAILED');
      }
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );

    expect(response.status).toBe(500);
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();
    expect(failureRows).toEqual([
      expect.objectContaining({
        lock_retained: false,
      }),
    ]);

    consoleErrorSpy.mockRestore();
  });
});
