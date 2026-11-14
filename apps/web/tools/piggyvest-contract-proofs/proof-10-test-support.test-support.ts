import { afterEach, vi } from 'vitest';
import { stepFundGoal } from './proof-10-fund-double-tap';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
export function trackDispose(fn: () => void): void {
  dispose = fn;
}
export function installCleanup(): void {
  afterEach(() => {
    dispose?.();
    vi.restoreAllMocks();
  });
}
export const transferPosts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
  ).length;

export async function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const main = h.state.mainWalletId as string;
  const goal = h.state.goalWalletId as string;
  const b = new ProofBuilder('p10', 'S8');
  const fund = await stepFundGoal(h.ctx, b, main, goal);
  return { h, b, main, goal, fund };
}
export const answer = (
  b: ProofBuilder,
  h: { ctx: Parameters<ProofBuilder['build']>[0] },
  id: string
) => b.build(h.ctx).findings.find((f) => f.id === id)?.answer;
