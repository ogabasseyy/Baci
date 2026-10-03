import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  retireTerminalSideEffectDrain: vi.fn(),
  verifyGatewayCharge: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));
vi.mock('./retire-terminal-side-effect-drain', () => ({
  retireTerminalSideEffectDrain: mocks.retireTerminalSideEffectDrain,
}));
vi.mock('./verify-gateway-charge', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./verify-gateway-charge')>();
  return { ...actual, verifyGatewayCharge: mocks.verifyGatewayCharge };
});

import {
  type DrainCandidateRow,
  drainFailedPaidOrderSideEffectRow,
} from './drain-failed-paid-order-side-effect-row';

function row(overrides: Record<string, unknown> = {}): DrainCandidateRow {
  return {
    order_id: 'order-1',
    transaction_id: 'txn-1',
    transactions: {
      amount: 10000,
      created_at: '2026-01-01T00:00:00.000Z',
      gateway: 'paystack',
      gateway_reference: 'REF-1',
      gateway_response: { status: 'success' },
      id: 'txn-1',
      merchant_id: 'merchant-1',
      metadata: null,
      order_id: 'order-1',
      platform_fee: 100,
      ...overrides,
    },
  };
}

function harness() {
  const fileWedgeReview = vi.fn();
  const finalizePayment = vi.fn();
  const scheduleAfter = vi.fn();
  const supabase = { from: vi.fn(), rpc: vi.fn() } as never;
  const drain = (candidate: DrainCandidateRow, deadlineMs?: number) =>
    drainFailedPaidOrderSideEffectRow({
      deadlineMs,
      fileWedgeReview: fileWedgeReview as never,
      finalizePayment: finalizePayment as never,
      orderId: 'order-1',
      row: candidate,
      scheduleAfter,
      supabase,
    });
  return { drain, fileWedgeReview, finalizePayment, scheduleAfter };
}

beforeEach(() => vi.clearAllMocks());

describe('drainFailedPaidOrderSideEffectRow', () => {
  it('retires and skips rows from unhealable gateways', async () => {
    const { drain, finalizePayment } = harness();
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    await expect(
      drain(row({ gateway: 'manual', gateway_response: { ok: true } }))
    ).resolves.toEqual({ action: 'skipped', reason: 'unhealable_gateway' });
    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        resolution: 'unhealable_gateway',
      })
    );
    expect(finalizePayment).not.toHaveBeenCalled();
    expect(mocks.verifyGatewayCharge).not.toHaveBeenCalled();
  });

  it('retires and skips a completed transaction without a reference', async () => {
    const { drain, finalizePayment } = harness();
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    await expect(drain(row({ gateway_reference: null }))).resolves.toEqual({
      action: 'skipped',
      reason: 'missing_gateway_reference',
    });
    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        resolution: 'missing_gateway_reference',
      })
    );
    expect(finalizePayment).not.toHaveBeenCalled();
  });

  it('finalizes an already-verified row and reports drained', async () => {
    const { drain, finalizePayment } = harness();
    finalizePayment.mockResolvedValue({ kind: 'completed' });

    await expect(drain(row())).resolves.toEqual({ action: 'drained' });

    expect(mocks.verifyGatewayCharge).not.toHaveBeenCalled();
    expect(finalizePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders:drain',
        emailMaxAttemptsPerSender: 1,
        gateway: 'paystack',
        gatewayResponse: { status: 'success' },
        orderId: 'order-1',
        reference: 'REF-1',
      })
    );
  });

  it('re-verifies an unverified charge before finalizing', async () => {
    const { drain, finalizePayment } = harness();
    mocks.verifyGatewayCharge.mockResolvedValue({
      ok: true,
      response: { status: 'success' },
    });
    finalizePayment.mockResolvedValue({ kind: 'completed' });

    await expect(drain(row({ gateway_response: null }))).resolves.toEqual({
      action: 'drained',
    });

    expect(mocks.verifyGatewayCharge).toHaveBeenCalledWith(
      'paystack',
      'REF-1',
      undefined,
      undefined
    );
    expect(finalizePayment).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayResponse: { status: 'success' } })
    );
  });

  it('retires and skips a terminally unverifiable reference', async () => {
    const { drain, finalizePayment } = harness();
    mocks.verifyGatewayCharge.mockResolvedValue({
      gatewayStatus: 'failed',
      ok: false,
      reason: 'gateway_status_not_success',
    });
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    await expect(drain(row({ gateway_response: null }))).resolves.toEqual({
      action: 'skipped',
      reason: 'gateway_status_not_success',
    });
    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: 'gateway_verification_negative',
      })
    );
    expect(finalizePayment).not.toHaveBeenCalled();
  });

  it('stops the loop when finalize overruns the pass deadline', async () => {
    const h = harness();
    h.finalizePayment.mockRejectedValue(
      new Error('refund_notification_delivery_deadline')
    );

    await expect(h.drain(row(), Date.now() + 60_000)).resolves.toEqual({
      action: 'stop_failed',
      reason: 'finalize_deadline_exceeded',
    });
    expect(h.finalizePayment).toHaveBeenCalledTimes(1);
  });
});
