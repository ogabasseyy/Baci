import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import {
  FUND_GOAL,
  stepDoubleTap,
  stepFundGoal,
  TAP_ONCE,
  TAP_SENDS_ONCE,
} from './proof-10-fund-double-tap';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
const transferPosts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
  ).length;

async function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const main = h.state.mainWalletId as string;
  const goal = h.state.goalWalletId as string;
  const b = new ProofBuilder('p10', 'S8');
  const fund = await stepFundGoal(h.ctx, b, main, goal);
  return { h, b, main, goal, fund };
}
const answer = (
  b: ProofBuilder,
  h: { ctx: Parameters<ProofBuilder['build']>[0] },
  id: string
) => b.build(h.ctx).findings.find((f) => f.id === id)?.answer;

describe('S8 fund goal from main', () => {
  it('moves the amount from main to the goal once', async () => {
    const { h, b, fund } = await setup();
    expect(fund?.sendAccepted).toBe(true);
    expect(fund?.amountKobo).toBe(AMOUNTS_KOBO.s8FundGoal);
    expect(answer(b, h, FUND_GOAL)).toBe('yes');
    expect(b.build(h.ctx).values).toMatchObject({
      fund_goal_main_delta_kobo: -AMOUNTS_KOBO.s8FundGoal,
      fund_goal_goal_delta_kobo: AMOUNTS_KOBO.s8FundGoal,
      fund_goal_terminal: 'success',
    });
  });

  it('does not claim success when the provider refuses the transfer', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const mainWallet = h.mock.sandbox.wallet(main);
    if (mainWallet) mainWallet.balance = 0;
    const b = new ProofBuilder('p10', 'S8');
    const fund = await stepFundGoal(
      h.ctx,
      b,
      main,
      h.state.goalWalletId as string
    );
    expect(fund?.sendAccepted).toBe(false);
    expect(answer(b, h, FUND_GOAL)).toBe('unknown');
    expect(b.build(h.ctx).status).toBe('inconclusive');
  });
});

describe('S8 double tap', () => {
  it('sends nothing on the second tap and the provider holds one transfer', async () => {
    const { h, b, main, goal, fund } = await setup();
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    // The only new POST is the wire-level repeat of the SAME reference.
    expect(transferPosts(h)).toBe(before + 1);
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('yes');
    expect(answer(b, h, TAP_ONCE)).toBe('yes');
    expect(b.build(h.ctx).values).toMatchObject({
      double_tap_app_second_send: 'not_sent',
      double_tap_wire_outcome: 'rejected',
      double_tap_rows_with_reference: 1,
      double_tap_extra_debit_kobo: 0,
    });
  });

  it('reports a provider that books the repeat as NOT exactly one transfer', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept' },
    });
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('yes');
    expect(answer(b, h, TAP_ONCE)).toBe('no');
    expect(b.build(h.ctx).values.double_tap_extra_debit_kobo).toBe(
      AMOUNTS_KOBO.s8FundGoal
    );
  });

  it('stays unknown when there is no accepted fund transfer to tap again', async () => {
    const { h, b, main, goal } = await setup();
    const posts = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, null);
    expect(transferPosts(h)).toBe(posts);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('unknown');
  });
});
