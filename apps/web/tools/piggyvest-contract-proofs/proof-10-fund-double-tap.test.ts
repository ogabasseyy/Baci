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

describe('S8 fund goal with fees', () => {
  it('accepts a wallet-to-wallet fee on the debit side', async () => {
    const { h, b } = await setup({ mock: { transferFeeKobo: 100 } });
    expect(answer(b, h, FUND_GOAL)).toBe('yes');
  });

  it('answers unknown when the goal got less than the amount and no fee was read', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const goal = h.state.goalWalletId as string;
    const real = h.ctx.api.verify.bind(h.ctx.api);
    const goalWallet = h.mock.sandbox.wallet(goal);
    const b = new ProofBuilder('p10', 'S8');
    // The goal ends up 100 short after the transfer settles.
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (goalWallet) goalWallet.balance -= 100;
      return out;
    };
    await stepFundGoal(h.ctx, b, h.state.mainWalletId as string, goal);
    expect(answer(b, h, FUND_GOAL)).toBe('unknown');
  });
});

describe('S8 fund goal with a short credit and a bad debit', () => {
  it('answers no, not unknown, when the debit is outside one transfer', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const goal = h.state.goalWalletId as string;
    const real = h.ctx.api.verify.bind(h.ctx.api);
    const goalWallet = h.mock.sandbox.wallet(goal);
    const mainWallet = h.mock.sandbox.wallet(main);
    const b = new ProofBuilder('p10', 'S8');
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (goalWallet) goalWallet.balance -= 100;
      if (mainWallet) mainWallet.balance -= AMOUNTS_KOBO.s8FundGoal;
      return out;
    };
    await stepFundGoal(h.ctx, b, main, goal);
    expect(answer(b, h, FUND_GOAL)).toBe('no');
  });
});

describe('S8 fund goal with unexplained extra debit', () => {
  async function withExtraDebit(
    extra: number,
    options: Parameters<typeof makeHarness>[0] = {}
  ) {
    const h = makeHarness(options);
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const real = h.ctx.api.verify.bind(h.ctx.api);
    const mainWallet = h.mock.sandbox.wallet(main);
    let taken = false;
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (mainWallet && !taken) {
        taken = true;
        mainWallet.balance -= extra;
      }
      return out;
    };
    const b = new ProofBuilder('p10', 'S8');
    await stepFundGoal(h.ctx, b, main, h.state.goalWalletId as string);
    return answer(b, h, FUND_GOAL);
  }

  it('answers unknown, not yes, when the debit exceeds the amount and no fee was read', async () => {
    expect(await withExtraDebit(500)).toBe('unknown');
  });

  it('answers no when the recorded fee does not account for the extra debit', async () => {
    expect(
      await withExtraDebit(500, {
        mock: { tsqShape: 'rich', transferFeeKobo: 100 },
      })
    ).toBe('no');
  });

  it('answers yes when the extra debit equals the recorded fee', async () => {
    expect(
      await withExtraDebit(100, {
        mock: { tsqShape: 'rich', transferFeeKobo: 100 },
      })
    ).toBe('yes');
  });
});

describe('S8 double tap', () => {
  it('stays unknown when an accepted repeat is hidden past the polling budget', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(true);
    h.mock.sandbox.options.listLagReads = 8;
    h.mock.sandbox.options.balanceLagReads = 8;
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_wire_outcome).toBe('accepted');
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('does not repeat on the wire while the original funding is still pending', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { tsqPendingPolls: 7 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(false);
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(transferPosts(h)).toBe(before);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

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

  it('answers no, not yes, when an accepted repeat shows a second record while its status stays pending', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept' },
    });
    const real = h.ctx.api.verify.bind(h.ctx.api);
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => ({
      ...(await real(...args)),
      data: { status: 'pending' },
    });
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_wire_outcome).toBe('accepted');
    expect(answer(b, h, TAP_ONCE)).toBe('no');
  });
});

describe('S8 stale balances after a terminal success', () => {
  it('answers unknown, not no, when balances lag past the polling budget', async () => {
    const { h, b, fund } = await setup({
      mock: { balanceLagReads: 8 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(true);
    expect(fund?.mainDeltaKobo).toBeNull();
    expect(answer(b, h, FUND_GOAL)).toBe('unknown');
    expect(b.build(h.ctx).values.fund_goal_main_delta_kobo).toBeNull();
  });

  it('does not tap again on a funding whose balances never moved', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { balanceLagReads: 8 },
      maxPolls: 6,
    });
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(transferPosts(h)).toBe(before);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });
});

describe('S8 fund goal with a fee on the goal credit', () => {
  async function shortCredit(short: number) {
    const h = makeHarness({ mock: { tsqShape: 'rich', transferFeeKobo: 100 } });
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const goal = h.state.goalWalletId as string;
    const real = h.ctx.api.verify.bind(h.ctx.api);
    const goalWallet = h.mock.sandbox.wallet(goal);
    let taken = false;
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (goalWallet && !taken) {
        taken = true;
        goalWallet.balance -= short;
      }
      return out;
    };
    const b = new ProofBuilder('p10', 'S8');
    await stepFundGoal(h.ctx, b, main, goal);
    return { h, b };
  }

  it('answers yes when the shortfall equals the fee read', async () => {
    const { h, b } = await shortCredit(100);
    expect(answer(b, h, FUND_GOAL)).toBe('yes');
  });

  it('answers no when the shortfall differs from the fee read', async () => {
    const { h, b } = await shortCredit(300);
    expect(answer(b, h, FUND_GOAL)).toBe('no');
  });
});
