import { recordGoalWallets } from './proof-7-goals';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { Answer } from './types';

let dispose: (() => void) | null = null;

/** Register as `afterEach(disposeGoalHarness)` in every suite using this. */
export function disposeGoalHarness(): void {
  dispose?.();
}

/** Hands a harness a test built itself to the same disposal. */
export function ownGoalHarness(h: ReturnType<typeof makeHarness>): void {
  dispose = h.dispose;
}

/** Runs proof 7's goal part on a fresh mock and returns what it recorded. */
export async function runGoals(
  options: Parameters<typeof makeHarness>[0] = {},
  destinationPaths: string[] = ['interest_payout_wallet'],
  afterSetup: (h: ReturnType<typeof makeHarness>) => void = () => undefined
) {
  const h = makeHarness(options);
  ownGoalHarness(h);
  await setupScenario(h.ctx);
  afterSetup(h);
  const b = new ProofBuilder('p7', 'T');
  const owner = {
    qa: h.ctx.qa,
    customerId: h.state.customerId ?? '',
    mainWalletId: h.state.mainWalletId,
  };
  await recordGoalWallets(
    h.ctx,
    b,
    owner,
    h.mock.sandbox.businessWalletId,
    destinationPaths
  );
  const result = b.build(h.ctx);
  const answer = (id: string): Answer | undefined =>
    result.findings.find((f) => f.id === id)?.answer;
  return { h, result, answer };
}
