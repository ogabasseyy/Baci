import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import {
  baseArgs,
  buildSupabase,
  richOrderRow,
} from './finalize-order-gateway-payment-fixtures';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  verify: vi.fn(),
  complete: vi.fn(),
  inventory: vi.fn(),
  notify: vi.fn(),
  effects: vi.fn(),
  settle: vi.fn(),
}));
vi.mock('./redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: mocks.capture,
}));
vi.mock('./verify-and-complete-redvault-payment', () => ({
  verifyAndCompleteRedvaultPayment: mocks.verify,
}));
vi.mock('./complete-order-gateway-payment', () => ({
  completeOrderGatewayPayment: mocks.complete,
}));
vi.mock('./confirm-paid-order-inventory', () => ({
  confirmPaidOrderInventoryOrRollback: mocks.inventory,
}));
vi.mock('./notify-paid-order', () => ({
  schedulePaidOrderNotifications: mocks.notify,
}));
vi.mock('./run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: mocks.effects,
}));
vi.mock('./settle-captured-order-payment', () => ({
  settleCapturedOrderPayment: mocks.settle,
}));

const completion = {
  actor: 'uba_redvault_verified_completion',
  already_completed: false,
  cancelled_at: null,
  order_already_paid: false,
  order_cancelled: false,
  order_number: 'ORDER-1',
  order_skipped_status: null,
  order_updated: true,
  payment_status: 'paid',
  previous_payment_status: 'unpaid',
  previous_shipping_status: 'pending',
  shipping_status: 'pending',
};
describe('actual finalizer REDVAULT routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.capture.mockResolvedValue({
      kind: 'captured_held',
      duplicate: false,
      reason: 'provider_eligibility_evidence_unavailable',
    });
    mocks.inventory.mockResolvedValue({ kind: 'confirmed' });
    mocks.effects.mockResolvedValue({ completedSteps: [], skippedSteps: [] });
  });
  it('runs paid effects only after the verified atomic approval', async () => {
    mocks.verify.mockResolvedValue({
      kind: 'approved',
      duplicate: false,
      inventoryConfirmed: true,
      completion,
    });
    expect(
      await finalizeOrderGatewayPayment(
        baseArgs(buildSupabase({ data: richOrderRow }))
      )
    ).toMatchObject({ kind: 'completed' });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.effects).toHaveBeenCalledOnce();
  });
  it('does not treat an approved duplicate as a second capture or first payment', async () => {
    mocks.verify.mockResolvedValue({
      kind: 'approved',
      duplicate: true,
      inventoryConfirmed: true,
      completion,
    });
    expect(
      await finalizeOrderGatewayPayment(
        baseArgs(buildSupabase({ data: richOrderRow }), {
          wonTransactionFlip: true,
        })
      )
    ).toMatchObject({ kind: 'completed' });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.inventory).not.toHaveBeenCalled();
  });
  it('keeps provider-verification failures held with no fulfilment or settlement', async () => {
    mocks.verify.mockResolvedValue(null);
    expect(
      await finalizeOrderGatewayPayment(
        baseArgs(buildSupabase({ data: richOrderRow }))
      )
    ).toMatchObject({ kind: 'captured_held' });
    for (const action of [
      mocks.complete,
      mocks.inventory,
      mocks.notify,
      mocks.effects,
      mocks.settle,
    ])
      expect(action).not.toHaveBeenCalled();
  });
});
