import { describe, expect, it, vi } from 'vitest';
import { captureOrHoldRedvaultPayment } from '@/lib/payments/redvault-capture-hold';

function buildRpcClient(
  captureData: unknown,
  captureError: unknown = null,
  paymentMethod: string | null = 'uba_redvault'
) {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: paymentMethod === null ? [] : [{ payment_method: paymentMethod }],
      error: null,
    })
    .mockResolvedValue({ data: captureData, error: captureError });
  return { rpc };
}

const input = {
  gateway: 'paystack' as const,
  gatewayResponse: {
    amount: 12_500,
    currency: 'NGN',
    reference: 'RV-reference',
    status: 'success',
  },
  merchantId: 'merchant-1',
  orderId: 'order-1',
  reference: 'RV-reference',
  transactionId: 'transaction-1',
};

describe('captureOrHoldRedvaultPayment', () => {
  it('returns the durable held result for a matching REDVAULT capture', async () => {
    const rpcClient = buildRpcClient({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).resolves.toEqual({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });
    expect(rpcClient.rpc).toHaveBeenCalledWith(
      'capture_or_hold_uba_redvault_payment',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_order_id: 'order-1',
        p_reference: 'RV-reference',
        p_transaction_id: 'transaction-1',
      })
    );
  });

  it('classifies the order through the scoped RPC client, never a table read', async () => {
    const rpcClient = buildRpcClient({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    await captureOrHoldRedvaultPayment({
      ...input,
      rpcClient: rpcClient as never,
    });

    expect(rpcClient.rpc).toHaveBeenNthCalledWith(
      1,
      'get_redvault_order_payment_method',
      { p_merchant_id: 'merchant-1', p_order_id: 'order-1' }
    );
    expect(rpcClient.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    'capture_reference_mismatch',
    'capture_amount_mismatch',
    'capture_currency_mismatch',
  ])('keeps a %s capture held', async (reason) => {
    const rpcClient = buildRpcClient({
      duplicate: false,
      kind: 'captured_held',
      reason,
    });

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).resolves.toMatchObject({ kind: 'captured_held', reason });
  });

  it('returns evidence review instead of a captured hold for non-success evidence', async () => {
    const rpcClient = buildRpcClient({
      duplicate: false,
      kind: 'capture_evidence_review',
      reason: 'capture_status_not_success',
    });

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).resolves.toEqual({
      duplicate: false,
      kind: 'capture_evidence_review',
      reason: 'capture_status_not_success',
    });
  });

  it('accepts an idempotent duplicate held receipt', async () => {
    const rpcClient = buildRpcClient({
      duplicate: true,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).resolves.toMatchObject({ duplicate: true, kind: 'captured_held' });
  });

  it('leaves non-REDVAULT payment paths unchanged', async () => {
    const rpcClient = buildRpcClient(
      { kind: 'not_redvault' },
      null,
      'paystack'
    );

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).resolves.toEqual({ kind: 'not_redvault' });
    expect(rpcClient.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the order is missing or merchant-mismatched', async () => {
    const rpcClient = buildRpcClient({ kind: 'captured_held' }, null, null);

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).rejects.toThrow('redvault_capture_hold_order_not_found');
    expect(rpcClient.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the capture RPC is unavailable', async () => {
    const rpcClient = buildRpcClient(null, new Error('rpc unavailable'));

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).rejects.toThrow('rpc unavailable');
  });

  it('rejects an ordinary-payment RPC result for a REDVAULT order', async () => {
    const rpcClient = buildRpcClient({ kind: 'not_redvault' });

    await expect(
      captureOrHoldRedvaultPayment({
        ...input,
        rpcClient: rpcClient as never,
      })
    ).rejects.toThrow('redvault_capture_hold_rpc_invalid_response');
  });
});
