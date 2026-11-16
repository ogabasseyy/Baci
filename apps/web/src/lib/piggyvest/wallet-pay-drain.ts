import 'server-only';
import type { WalletPayPurpose } from '@/schemas/piggyvest-wallet-pay';
import { createWalletPayPorts } from './wallet-pay-ports';
import { reconcileWalletPayTransfer } from './wallet-pay-reconciliation';
import type { WalletPayRuntime } from './wallet-pay-runtime';
import { refundWalletPayment, walletPayDelivery } from './wallet-pay-service';

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
      { kind: 'payment', operationId, surfaceErrors: true },
      {
        loadDispatched: ports.evidence.loadDispatched,
        queryProvider: ports.queryProvider,
        settle: ports.evidence.settle,
        release: ports.evidence.release,
      }
    );
  },
  refund: refundWalletPayment,
  // A VTU purchase mid-vend is vended only by the VTU recovery pass, under the
  // delivery claim: the drain takes no claim on it (Codex P1).
  midVtuVend: async (runtime: WalletPayRuntime, operationId: string) =>
    (await walletPayDelivery(runtime).vtuDeliveryState(operationId)) ===
    'processing',
};

export interface WalletPayDrainSummary {
  released: number;
  settled: number;
  /** Still open after the check: unverified, held for review or refunding. */
  pending: number;
  refunds: number;
  delivered: number;
  skipped: number;
  /** Left for the next run: too little of this run's time remained. */
  deferred: number;
  failed: number;
}

// Time reserved after each phase, so a slow settle phase cannot starve the
// refunds and deliveries after it (Codex P2): settling stops with 180 s
// left, refunds with 90 s, deliveries with 30 s.
const RESERVE_AFTER_SETTLE_MS = 180_000;
const RESERVE_AFTER_REFUND_MS = 90_000;
const RESERVE_AFTER_DELIVER_MS = 30_000;

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
    /** The invocation's hard stop (epoch ms); unset runs without a budget. */
    deadlineMs?: number;
  },
  deps: {
    worker: (
      runtime: WalletPayRuntime
    ) => Pick<Worker, 'listWork' | 'releaseStale' | 'claim'>;
    reconcilePayment: (
      runtime: WalletPayRuntime,
      id: string
    ) => Promise<string | undefined>;
    refund: typeof refundWalletPayment;
    midVtuVend: (
      runtime: WalletPayRuntime,
      operationId: string
    ) => Promise<boolean>;
  } = defaultDeps
): Promise<WalletPayDrainSummary> {
  const { runtime } = input;
  const worker = deps.worker(runtime);
  const summary: WalletPayDrainSummary = {
    released: 0,
    settled: 0,
    pending: 0,
    refunds: 0,
    delivered: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
  };
  const outOfTime = (reserveMs: number) =>
    input.deadlineMs !== undefined && Date.now() > input.deadlineMs - reserveMs;
  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      summary.failed += 1;
    }
  };
  const work = await worker.listWork(input.maxRows ?? 50);
  for (const id of work.settle) {
    if (outOfTime(RESERVE_AFTER_SETTLE_MS)) {
      summary.deferred += 1;
      continue;
    }
    await attempt(async () => {
      if (await worker.releaseStale(id)) summary.released += 1;
      else {
        // Count what the reconciliation concluded, not that it did not throw:
        // an unverified record or a held fee is not settled (Muse).
        const outcome = await deps.reconcilePayment(runtime, id);
        if (outcome === 'confirmed') summary.settled += 1;
        else if (outcome === 'released') summary.released += 1;
        else summary.pending += 1;
      }
    });
  }
  for (const id of work.refund) {
    if (outOfTime(RESERVE_AFTER_REFUND_MS)) {
      summary.deferred += 1;
      continue;
    }
    await attempt(async () => {
      const outcome = await deps.refund({
        runtime,
        paymentId: id,
        surfaceErrors: true,
      });
      // A refund the wallets could not cover or read stays owed for the next
      // run: not counted as sent (CodeRabbit).
      if (outcome === 'unfunded' || outcome === 'unavailable')
        summary.deferred += 1;
      else summary.refunds += 1;
    });
  }
  for (const item of work.deliver) {
    if (outOfTime(RESERVE_AFTER_DELIVER_MS)) {
      summary.deferred += 1;
      continue;
    }
    await attempt(async () => {
      const deliver = input.deliverers[item.purpose];
      if (!deliver) {
        summary.skipped += 1;
        return;
      }
      if (
        item.purpose === 'vtu' &&
        (await deps.midVtuVend(runtime, item.operationId))
      ) {
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
  }
  return summary;
}
