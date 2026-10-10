import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import {
  baseArgs,
  buildSupabase,
  completion,
  richOrderRow,
} from '@/lib/payments/finalize-order-gateway-payment-fixtures';

const mocks = vi.hoisted(() => ({
  completeOrderGatewayPayment: vi.fn(),
  clearPaymentSideEffectSeed: vi.fn(),
  settleCapturedOrderPayment: vi.fn(),
  ensurePaidOrderInventoryConfirmed: vi.fn(),
  fileInventoryConfirmationFailureReview: vi.fn(),
  handlePaymentForCancelledOrder: vi.fn(),
  captureOrHoldRedvaultPayment: vi.fn(),
  notifyNewOrder: vi.fn(),
  notifyPaymentReceived: vi.fn(),
  persistPaidOrderSideEffectRetry: vi.fn(),
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
  runPaidOrderSideEffects: vi.fn(),
}));

vi.mock('@/lib/payments/clear-payment-side-effect-seed', () => ({
  clearPaymentSideEffectSeed: mocks.clearPaymentSideEffectSeed,
}));

vi.mock(
  '@/lib/payments/complete-order-gateway-payment',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    completeOrderGatewayPayment: mocks.completeOrderGatewayPayment,
  })
);
vi.mock(
  '@/lib/payments/ensure-paid-order-inventory-confirmed',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ensurePaidOrderInventoryConfirmed: mocks.ensurePaidOrderInventoryConfirmed,
    rollbackOrderStatusAfterInventoryConfirmationFailure:
      mocks.rollbackOrderStatusAfterInventoryConfirmationFailure,
  })
);
vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview:
    mocks.fileInventoryConfirmationFailureReview,
}));
vi.mock('@/lib/payments/redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: mocks.captureOrHoldRedvaultPayment,
}));
vi.mock('@/lib/payments/handle-payment-for-cancelled-order', () => ({
  handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
}));
vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: mocks.notifyNewOrder,
  notifyPaymentReceived: mocks.notifyPaymentReceived,
}));
vi.mock(
  '@/lib/payments/paid-order-retry-persistence',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    persistPaidOrderSideEffectRetry: mocks.persistPaidOrderSideEffectRetry,
  })
);
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: mocks.runPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/settle-captured-order-payment', () => ({
  settleCapturedOrderPayment: mocks.settleCapturedOrderPayment,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearPaymentSideEffectSeed.mockResolvedValue(undefined);
  mocks.captureOrHoldRedvaultPayment.mockResolvedValue({
    kind: 'not_redvault',
  });
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
  mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
  mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);
  mocks.runPaidOrderSideEffects.mockResolvedValue({
    concurrentTakeoverSteps: [],
    failedSteps: [],
    ranSteps: ['merchant_settlement'],
    skippedSteps: [],
  });
});

describe('finalizeOrderGatewayPayment abort signal', () => {
  it('forwards the abort signal to the paid-order side effects', async () => {
    const signal = AbortSignal.timeout(1000);

    await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), { signal })
    );

    expect(mocks.runPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ signal })
    );
  });
});
