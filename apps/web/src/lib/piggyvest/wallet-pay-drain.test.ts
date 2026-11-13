import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWalletPayDrain } from './wallet-pay-drain';

vi.mock('server-only', () => ({}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const runtime = {} as never;
const worker = {
  listWork: vi.fn(),
  releaseStale: vi.fn(),
  claim: vi.fn(),
};
const deps = {
  worker: () => worker as never,
  reconcilePayment: vi.fn(),
  refund: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  worker.listWork.mockResolvedValue({ settle: [], refund: [], deliver: [] });
  worker.releaseStale.mockResolvedValue(false);
  deps.reconcilePayment.mockResolvedValue('pending');
  deps.refund.mockResolvedValue('pending');
});

describe('runWalletPayDrain', () => {
  it('releases never-sent reservations and reconciles sent payments, never posting', async () => {
    worker.listWork.mockResolvedValue({
      settle: [A, B],
      refund: [],
      deliver: [],
    });
    worker.releaseStale.mockImplementation(async (id: string) => id === A);
    const summary = await runWalletPayDrain({ runtime, deliverers: {} }, deps);
    expect(deps.reconcilePayment).toHaveBeenCalledTimes(1);
    expect(deps.reconcilePayment).toHaveBeenCalledWith(runtime, B);
    expect(summary).toMatchObject({ released: 1, settled: 1 });
  });

  it('sends every owed refund through the exactly-once refund step', async () => {
    worker.listWork.mockResolvedValue({
      settle: [],
      refund: [A, B],
      deliver: [],
    });
    await runWalletPayDrain({ runtime, deliverers: {} }, deps);
    expect(deps.refund).toHaveBeenCalledWith({ runtime, paymentId: A });
    expect(deps.refund).toHaveBeenCalledWith({ runtime, paymentId: B });
  });

  it('hands an uncollected payment to its product, and skips products without a deliverer', async () => {
    worker.listWork.mockResolvedValue({
      settle: [],
      refund: [],
      deliver: [
        { operationId: A, purpose: 'imei_check' },
        { operationId: B, purpose: 'vtu' },
      ],
    });
    worker.claim.mockResolvedValue({
      status: 'claimed',
      purpose: 'imei_check',
      purchaseRef: 'lookup-1',
      amountKobo: 50000,
      claimToken: C,
    });
    const imei = vi.fn(async () => undefined);
    const summary = await runWalletPayDrain(
      { runtime, deliverers: { imei_check: imei } },
      deps
    );
    expect(worker.claim).toHaveBeenCalledTimes(1);
    expect(worker.claim).toHaveBeenCalledWith(A);
    expect(imei).toHaveBeenCalledWith({
      runtime,
      operationId: A,
      purchaseRef: 'lookup-1',
      claimToken: C,
      reclaimed: false,
    });
    expect(summary).toMatchObject({ delivered: 1, skipped: 1 });
  });

  it('leaves a payment alone when the claim is lost (a customer request is delivering)', async () => {
    worker.listWork.mockResolvedValue({
      settle: [],
      refund: [],
      deliver: [{ operationId: A, purpose: 'imei_check' }],
    });
    worker.claim.mockResolvedValue({ status: 'busy' });
    const imei = vi.fn();
    await runWalletPayDrain(
      { runtime, deliverers: { imei_check: imei } },
      deps
    );
    expect(imei).not.toHaveBeenCalled();
  });

  it('keeps going when one item fails, and counts the failure', async () => {
    worker.listWork.mockResolvedValue({
      settle: [A],
      refund: [B],
      deliver: [],
    });
    deps.reconcilePayment.mockRejectedValue(new Error('down'));
    const summary = await runWalletPayDrain({ runtime, deliverers: {} }, deps);
    expect(deps.refund).toHaveBeenCalledWith({ runtime, paymentId: B });
    expect(summary).toMatchObject({ failed: 1 });
  });
});
