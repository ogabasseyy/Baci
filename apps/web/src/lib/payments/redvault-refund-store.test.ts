import { describe, expect, it, vi } from 'vitest';
import { RedvaultRefundStore } from './redvault-refund-store';

const reserved = {
  amount_kobo: 9_500,
  attempt_reference: 'RV-capture',
  id: 'refund-1',
  provider_reference: null,
  provider_status: null,
  state: 'pending',
};

function storeWith(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, store: new RedvaultRefundStore({ rpc }) };
}

describe('REDVAULT refund store', () => {
  it.each([
    0, -1,
  ])('rejects a nonpositive refund receipt of %s kobo', async (amount) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...reserved, amount_kobo: amount }],
      error: null,
    });
    const store = new RedvaultRefundStore({ rpc });

    await expect(
      store.reserve({
        attemptId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'ops-invalid-refund',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        type: 'full_capture',
      })
    ).rejects.toThrow('REDVAULT refund RPC returned an invalid refund row');
  });

  it('uses only the service-worker RPC boundary for durable reservations', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [reserved], error: null });
    const store = new RedvaultRefundStore({ rpc });
    await expect(
      store.reserve({
        attemptId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'ops-return-1',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        type: 'merchandise_units',
        units: [
          {
            orderItemId: '22222222-2222-4222-8222-222222222222',
            unitOrdinal: 1,
          },
        ],
      })
    ).resolves.toMatchObject({ amountKobo: 9_500, state: 'pending' });
    expect(rpc).toHaveBeenCalledWith('reserve_uba_redvault_refund', {
      p_attempt_id: '11111111-1111-4111-8111-111111111111',
      p_idempotency_key: 'ops-return-1',
      p_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      p_type: 'merchandise_units',
      p_units: [
        { orderItemId: '22222222-2222-4222-8222-222222222222', unitOrdinal: 1 },
      ],
    });
  });

  it('rejects multiple refund rows instead of accepting the first receipt', async () => {
    const { store } = storeWith([reserved, { ...reserved, id: 'refund-2' }]);

    await expect(
      store.reserve({
        attemptId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'ops-multiple-rows',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        type: 'full_capture',
      })
    ).rejects.toThrow('REDVAULT refund RPC must return exactly one refund row');
  });

  it('persists a known accepted provider id without terminalizing the refund', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...reserved,
          provider_reference: 'provider-refund-1',
          provider_status: 'pending',
          state: 'processing',
        },
      ],
      error: null,
    });
    const store = new RedvaultRefundStore({ rpc });
    await expect(
      store.recordProviderSubmission({
        id: 'refund-1',
        providerReference: 'provider-refund-1',
        providerStatus: 'pending',
      })
    ).resolves.toMatchObject({
      providerReference: 'provider-refund-1',
      providerStatus: 'pending',
      state: 'processing',
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_uba_redvault_refund_provider_submission',
      {
        p_provider_reference: 'provider-refund-1',
        p_provider_status: 'pending',
        p_refund_id: 'refund-1',
      }
    );
  });

  it.each([
    {
      call: (store: RedvaultRefundStore) => store.claimNext(),
      name: 'claims the next refund',
      rpcName: 'claim_next_uba_redvault_refund',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.finish({ id: 'refund-1', outcome: 'processed' }),
      name: 'finishes a refund',
      rpcName: 'finish_uba_redvault_refund',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.reconcile({
          id: 'refund-1',
          providerStatus: 'processed',
          reconciliationClaimToken: '11111111-1111-4111-8111-111111111111',
        }),
      name: 'reconciles a refund',
      rpcName: 'reconcile_uba_redvault_refund',
    },
  ])('$name with one valid public RPC receipt', async ({ call, rpcName }) => {
    const { rpc, store } = storeWith([{ ...reserved, state: 'processing' }]);

    await expect(call(store)).resolves.toMatchObject({ id: 'refund-1' });
    expect(rpc).toHaveBeenCalledWith(rpcName, expect.any(Object));
  });

  it.each([
    {
      call: (store: RedvaultRefundStore) => store.claimNext(),
      name: 'claim next',
    },
    {
      call: (store: RedvaultRefundStore) => store.claimNextReconciliation(),
      name: 'claim reconciliation',
    },
  ])('$name returns null for an empty public RPC receipt', async ({ call }) => {
    const { store } = storeWith([]);
    await expect(call(store)).resolves.toBeNull();
  });

  it.each([
    {
      call: (store: RedvaultRefundStore) => store.claimNext(),
      name: 'claim next',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.finish({ id: 'refund-1', outcome: 'failed' }),
      name: 'finish',
    },
    {
      call: (store: RedvaultRefundStore) => store.claimNextReconciliation(),
      name: 'claim reconciliation',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.reconcile({
          id: 'refund-1',
          providerStatus: 'failed',
          reconciliationClaimToken: '11111111-1111-4111-8111-111111111111',
        }),
      name: 'reconcile',
    },
  ])('$name rejects malformed public RPC receipts', async ({ call }) => {
    const { store } = storeWith([{ ...reserved, amount_kobo: 0 }]);
    await expect(call(store)).rejects.toThrow('REDVAULT');
  });

  it.each([
    {
      call: (store: RedvaultRefundStore) => store.claimNext(),
      name: 'claim next',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.finish({ id: 'refund-1', outcome: 'failed' }),
      name: 'finish',
    },
    {
      call: (store: RedvaultRefundStore) => store.claimNextReconciliation(),
      name: 'claim reconciliation',
    },
    {
      call: (store: RedvaultRefundStore) =>
        store.reconcile({
          id: 'refund-1',
          providerStatus: 'failed',
          reconciliationClaimToken: '11111111-1111-4111-8111-111111111111',
        }),
      name: 'reconcile',
    },
  ])('$name surfaces RPC failures', async ({ call }) => {
    const { store } = storeWith(null, { message: 'database rejected call' });
    await expect(call(store)).rejects.toThrow('Unable to');
  });

  it('returns a bound reconciliation claim from its public RPC', async () => {
    const { rpc, store } = storeWith([
      {
        ...reserved,
        provider_reference: 'provider-refund-1',
        reconciliation_claim_token: '11111111-1111-4111-8111-111111111111',
        state: 'processing',
      },
    ]);

    await expect(store.claimNextReconciliation()).resolves.toMatchObject({
      reconciliationClaimToken: '11111111-1111-4111-8111-111111111111',
      refund: { id: 'refund-1', providerReference: 'provider-refund-1' },
    });
    expect(rpc).toHaveBeenCalledWith(
      'claim_next_uba_redvault_refund_reconciliation',
      {}
    );
  });
});
