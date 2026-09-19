import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { resolveOrderGatewayCompletion } from './resolve-order-gateway-completion';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  verify: vi.fn(),
  complete: vi.fn(),
  fileReview: vi.fn(),
  scopedClient: { __scopedRouteClient: true },
}));
vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(),
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
vi.mock('./file-redvault-inventory-confirmation-review', () => ({
  fileRedvaultInventoryConfirmationReview: mocks.fileReview,
}));
const input = {
  actor: 'test',
  gateway: 'paystack' as const,
  gatewayResponse: {},
  merchantId: 'merchant',
  orderId: 'order',
  reference: 'RV-test',
  supabase: {} as never,
  transactionId: 'transaction',
};
const held = {
  kind: 'captured_held',
  duplicate: false,
  reason: 'provider_eligibility_evidence_unavailable',
};

describe('gateway completion routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createStorefrontOrderRpcClient).mockReturnValue(
      mocks.scopedClient as never
    );
    mocks.capture.mockResolvedValue(held);
  });
  it('never falls through to ordinary completion for unverified REDVAULT', async () => {
    mocks.verify.mockResolvedValue(null);
    expect(await resolveOrderGatewayCompletion(input)).toEqual({
      ok: false,
      outcome: held,
    });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fileReview).toHaveBeenCalledWith({
      gatewayReference: 'RV-test',
      merchantId: 'merchant',
      metadata: { reason: held.reason },
      orderId: 'order',
      reason: `REDVAULT capture held: ${held.reason}`,
      supabase: mocks.scopedClient,
      transactionId: 'transaction',
    });
  });
  it('uses the atomic approved receipt without repeating normal completion', async () => {
    const completion = { order_updated: true, payment_status: 'paid' };
    mocks.verify.mockResolvedValue({
      kind: 'approved',
      duplicate: false,
      inventoryConfirmed: true,
      completion,
    });
    expect(await resolveOrderGatewayCompletion(input)).toEqual({
      ok: true,
      completion,
      redvaultDuplicate: false,
      redvaultInventoryConfirmed: true,
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('does not replay first-completion flags from a duplicate stored receipt', async () => {
    mocks.verify.mockResolvedValue({
      kind: 'approved',
      duplicate: true,
      inventoryConfirmed: true,
      completion: {
        order_updated: true,
        already_completed: false,
        order_already_paid: false,
        payment_status: 'paid',
      },
    });
    expect(await resolveOrderGatewayCompletion(input)).toMatchObject({
      ok: true,
      redvaultDuplicate: true,
      completion: {
        order_updated: false,
        already_completed: true,
        order_already_paid: true,
      },
    });
  });
  it('does not verify non-card-gateway or rejected capture evidence', async () => {
    await resolveOrderGatewayCompletion({ ...input, gateway: 'korapay' });
    mocks.capture.mockResolvedValue({ kind: 'capture_evidence_review' });
    await resolveOrderGatewayCompletion(input);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fileReview).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'REDVAULT capture evidence requires review: undefined',
        supabase: mocks.scopedClient,
      })
    );
  });
  it('fails closed on approval uncertainty instead of retrying ordinary completion', async () => {
    mocks.verify.mockRejectedValue(new Error('response lost'));
    expect(await resolveOrderGatewayCompletion(input)).toMatchObject({
      ok: false,
      outcome: { kind: 'capture_hold_failed' },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('runs REDVAULT approval through the scoped route client, not the service client', async () => {
    mocks.verify.mockResolvedValue({
      kind: 'approved',
      duplicate: false,
      inventoryConfirmed: true,
      completion: { order_updated: true },
    });
    await resolveOrderGatewayCompletion(input);
    expect(createStorefrontOrderRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant', userId: null })
    );
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant',
        transactionId: 'transaction',
      })
    );
    const passedClient = mocks.verify.mock.calls[0][0].supabase;
    expect(passedClient).toBe(mocks.scopedClient);
    expect(passedClient).not.toBe(input.supabase);
  });
  it('preserves ordinary gateway completion', async () => {
    mocks.capture.mockResolvedValue({ kind: 'not_redvault' });
    mocks.complete.mockResolvedValue({
      ok: true,
      completion: { order_updated: true },
    });
    expect(await resolveOrderGatewayCompletion(input)).toMatchObject({
      ok: true,
      redvaultDuplicate: false,
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
});
