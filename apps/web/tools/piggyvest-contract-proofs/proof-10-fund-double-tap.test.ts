import { describe, expect, it } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { FUND_GOAL, stepFundGoal } from './proof-10-fund-double-tap';
import {
  answer,
  installCleanup,
  setup,
  trackDispose,
} from './proof-10-test-support.test-support';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

installCleanup();

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
    trackDispose(h.dispose);
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
    trackDispose(h.dispose);
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
    trackDispose(h.dispose);
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
    trackDispose(h.dispose);
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

describe('S8 fund goal with a fee on the goal credit', () => {
  async function shortCredit(short: number) {
    const h = makeHarness({ mock: { tsqShape: 'rich', transferFeeKobo: 100 } });
    trackDispose(h.dispose);
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
