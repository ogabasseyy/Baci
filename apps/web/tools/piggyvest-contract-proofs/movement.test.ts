import { afterEach, describe, expect, it } from 'vitest';
import { settledAfterMovement } from './movement';
import { settledWallets } from './poll';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

async function setup(maxPolls: number) {
  const h = makeHarness({ maxPolls });
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const main = h.state.mainWalletId as string;
  const goal = h.state.goalWalletId as string;
  const baseline = await settledWallets(h.ctx, [main, goal]);
  return { h, main, goal, baseline };
}

describe('settledAfterMovement', () => {
  it('reports moved and settled once the balance changes', async () => {
    const { h, main, goal, baseline } = await setup(3);
    const w = h.mock.sandbox.wallet(main);
    if (w) w.balance -= 50;
    const out = await settledAfterMovement(h.ctx, [main, goal], baseline, [
      main,
    ]);
    expect(out.moved).toBe(true);
    expect(out.settled).toBe(true);
  });
  it('publishes nothing when the balance never moves within the budget', async () => {
    const { h, main, goal, baseline } = await setup(3);
    const out = await settledAfterMovement(h.ctx, [main, goal], baseline, [
      main,
    ]);
    expect(out.moved).toBe(false);
    expect(out.settled).toBe(false);
  });
  it('needs EVERY required wallet to move', async () => {
    const { h, main, goal, baseline } = await setup(3);
    const w = h.mock.sandbox.wallet(main);
    if (w) w.balance -= 50;
    const out = await settledAfterMovement(h.ctx, [main, goal], baseline, [
      main,
      goal,
    ]);
    expect(out.moved).toBe(false);
  });
});
