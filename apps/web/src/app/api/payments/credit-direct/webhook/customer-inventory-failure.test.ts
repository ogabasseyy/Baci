import { beforeEach, describe, expect, it, vi } from 'vitest';
import { respondCustomerInventoryFailure } from './customer-inventory-failure';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const ensureMocks = vi.hoisted(() => ({ rollback: vi.fn() }));

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => ({
  rollbackOrderStatusAfterInventoryConfirmationFailure: ensureMocks.rollback,
}));

const reviewMocks = vi.hoisted(() => ({ fileReview: vi.fn() }));

vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview: reviewMocks.fileReview,
}));

const payloadMocks = vi.hoisted(() => ({ buildPayload: vi.fn() }));

vi.mock('@/lib/payments/inventory-confirmation-response', () => ({
  buildInventoryConfirmationFailurePayload: payloadMocks.buildPayload,
}));

function baseInput() {
  return {
    supabase: { from: vi.fn() } as never,
    merchantId: 'merchant-123',
    orderId: 'order-abc',
    previousPaymentStatus: 'pending',
    previousShippingStatus: null,
    gatewayReference: 'txn-123',
    inventoryError: new Error('serialized_inventory_unavailable'),
  };
}

describe('respondCustomerInventoryFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMocks.rollback.mockResolvedValue(undefined);
    reviewMocks.fileReview.mockResolvedValue(undefined);
    payloadMocks.buildPayload.mockReturnValue({
      code: 'serialized_inventory_unavailable',
      error: 'serialized_inventory_unavailable',
    });
  });

  it('rolls back fenced to bnpl_approved and returns 409 when unavailable', async () => {
    const response = await respondCustomerInventoryFailure(baseInput());

    expect(ensureMocks.rollback).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-123',
      'order-abc',
      {
        payment_status: 'pending',
        shipping_status: null,
      },
      { onlyIfPaymentStatus: ['bnpl_approved'] }
    );
    expect(reviewMocks.fileReview).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'serialized_inventory_unavailable',
    });
  });

  it('returns 500 for a generic inventory failure after rollback', async () => {
    payloadMocks.buildPayload.mockReturnValue({
      code: 'INVENTORY_CONFIRMATION_FAILED',
      error: 'Inventory confirmation failed',
    });

    const response = await respondCustomerInventoryFailure({
      ...baseInput(),
      inventoryError: new Error('boom'),
    });

    expect(ensureMocks.rollback).toHaveBeenCalled();
    expect(reviewMocks.fileReview).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
  });

  it('files a review and returns 500 when the rollback itself fails', async () => {
    ensureMocks.rollback.mockRejectedValueOnce(new Error('rollback boom'));

    const response = await respondCustomerInventoryFailure(baseInput());

    expect(reviewMocks.fileReview).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-abc',
        merchantId: 'merchant-123',
        transactionId: null,
        gatewayReference: 'txn-123',
      })
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 'INVENTORY_CONFIRMATION_CLEANUP_FAILED',
    });
  });
});
