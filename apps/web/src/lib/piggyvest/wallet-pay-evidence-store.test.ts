import { describe, expect, it, vi } from 'vitest';
import { createWalletPayEvidenceStore } from './wallet-pay-evidence-store';
import { WALLET_PAY_EVIDENCE_STATEMENTS as sql } from './wallet-pay-statements';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const INTEGRATION = '8e3a5c62-4f4f-4a8e-9d73-5b6c7d8e9fa1';
const proof = {
  operationId: OP,
  providerTransactionId: 'txn-1',
  reference: `pvb-pay-${OP}`,
  amountKobo: 100000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  businessId: 'business-1',
  feeKobo: 0,
};
const rows = (result: unknown) => ({ rows: [{ result }] });
function store(answer: unknown) {
  const execute = vi.fn(
    async (_statement: string, _parameters: readonly string[]) => rows(answer)
  );
  return {
    execute,
    store: createWalletPayEvidenceStore({
      integrationId: INTEGRATION,
      environment: 'staging',
      execute,
    }),
  };
}

describe('createWalletPayEvidenceStore', () => {
  it('settles a payment and a refund through their own functions', async () => {
    const payment = store('confirmed');
    await expect(payment.store.settle('payment', proof)).resolves.toBe(
      'confirmed'
    );
    expect(payment.execute).toHaveBeenCalledWith(sql.settlePayment, [
      INTEGRATION,
      'staging',
      JSON.stringify(proof),
    ]);
    const refund = store('needs_review');
    await expect(refund.store.settle('refund', proof)).resolves.toBe(
      'needs_review'
    );
    expect(refund.execute.mock.calls[0][0]).toBe(sql.settleRefund);
  });

  it('releases through the matching function', async () => {
    const payment = store('released');
    await expect(payment.store.release('payment', proof)).resolves.toBe(
      'released'
    );
    expect(payment.execute.mock.calls[0][0]).toBe(sql.releasePayment);
  });

  it('refuses an answer the database does not give for that kind', async () => {
    // 'refunding' is a payment-only answer.
    await expect(
      store('refunding').store.settle('refund', proof)
    ).rejects.toThrow();
  });

  it('loads a dispatched payment or refund by operation id', async () => {
    const none = store(null);
    await expect(none.store.loadDispatched('refund', OP)).resolves.toBeNull();
    expect(none.execute).toHaveBeenCalledWith(sql.readDispatchedRefund, [
      INTEGRATION,
      'staging',
      OP,
    ]);
  });

  it('resolves a webhook reference, skipping references that are not ours', async () => {
    const found = store({ kind: 'refund', operationId: OP });
    await expect(
      found.store.findByReference(`pvb-refund-${OP}-2`)
    ).resolves.toEqual({
      kind: 'refund',
      operationId: OP,
    });
    const foreign = store(null);
    await expect(
      foreign.store.findByReference('pvb-save-123')
    ).resolves.toBeNull();
    expect(foreign.execute).not.toHaveBeenCalled();
  });
});
