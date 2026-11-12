import 'server-only';
import type { WalletPayPurpose } from '@/schemas/piggyvest-wallet-pay';
import { createWalletPayPorts } from './wallet-pay-ports';
import { reconcileWalletPayTransfer } from './wallet-pay-reconciliation';
import type { WalletPayRuntime } from './wallet-pay-runtime';
import { refundWalletPayment } from './wallet-pay-service';

/**
 * Delivers (or refunds) one confirmed payment nobody collected. It holds the
 * delivery claim and must finish it with the token.
 */
export type WalletPayDeliverer = (input: {
  runtime: WalletPayRuntime;
  operationId: string;
  purchaseRef: string;
  claimToken: string;
  reclaimed: boolean;
}) => Promise<void>;

type Worker = ReturnType<typeof createWalletPayPorts>['worker'];

const defaultDeps = {
  worker: (runtime: WalletPayRuntime) => createWalletPayPorts(runtime).worker,
  reconcilePayment: async (runtime: WalletPayRuntime, operationId: string) => {
    const ports = createWalletPayPorts(runtime);
    return await reconcileWalletPayTransfer(
      { kind: 'payment', operationId },
      {
        loadDispatched: ports.evidence.loadDispatched,
        queryProvider: ports.queryProvider,
        settle: ports.evidence.settle,
        release: ports.evidence.release,
      }
    );
  },
  refund: refundWalletPayment,
};

export interface WalletPayDrainSummary {
  released: number;
  settled: number;
  refunds: number;
  delivered: number;
  skipped: number;
  failed: number;
}

/**
 * The wallet pay background job: whatever the customer's own requests did
 * not finish. It releases reservations that were never sent, reconciles sent
 * payments from PiggyVest's records (never re-posting), sends owed refunds
 * through the exactly-once refund step, and hands confirmed payments nobody
 * collected (15 minutes on) to their product's deliverer. Runs under the
 * recovery runtime, so switching wallet pay off never strands money. Each item
 * is isolated: one failure is counted, never stops the rest.
 */
export async function runWalletPayDrain(
  input: {
    runtime: WalletPayRuntime;
    deliverers: Partial<Record<WalletPayPurpose, WalletPayDeliverer>>;
    maxRows?: number;
  },
  deps: {
    worker: (
      runtime: WalletPayRuntime
    ) => Pick<Worker, 'listWork' | 'releaseStale' | 'claim'>;
    reconcilePayment: (
      runtime: WalletPayRuntime,
      id: string
    ) => Promise<unknown>;
    refund: typeof refundWalletPayment;
  } = defaultDeps
): Promise<WalletPayDrainSummary> {
  const { runtime } = input;
  const worker = deps.worker(runtime);
  const summary: WalletPayDrainSummary = {
    released: 0,
    settled: 0,
    refunds: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
  };
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      summary.failed += 1;
    }
  };
  const work = await worker.listWork(input.maxRows ?? 50);
  for (const id of work.settle)
    await attempt(async () => {
      if (await worker.releaseStale(id)) summary.released += 1;
      else {
        await deps.reconcilePayment(runtime, id);
        summary.settled += 1;
      }
    });
  for (const id of work.refund)
    await attempt(async () => {
      await deps.refund({ runtime, paymentId: id });
      summary.refunds += 1;
    });
  for (const item of work.deliver)
    await attempt(async () => {
      const deliver = input.deliverers[item.purpose];
      if (!deliver) {
        summary.skipped += 1;
        return;
      }
      const claim = await worker.claim(item.operationId);
      if (claim.status !== 'claimed' && claim.status !== 'reclaimed') return;
      await deliver({
        runtime,
        operationId: item.operationId,
        purchaseRef: claim.purchaseRef,
        claimToken: claim.claimToken,
        reclaimed: claim.status === 'reclaimed',
      });
      summary.delivered += 1;
    });
  return summary;
}
