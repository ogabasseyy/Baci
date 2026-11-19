import { describe, expect, it } from 'vitest';
import { EARLIER_UNSETTLED, MovementLedger } from './movement-ledger';
import { DEPOSIT_ONCE, stepDeposit } from './proof-10-deposit';
import {
  FUND_GOAL,
  stepDoubleTap,
  stepFundGoal,
  TAP_ONCE,
} from './proof-10-fund-double-tap';
import { installCleanup, setup } from './proof-10-test-support.test-support';
import {
  stepTimeoutRetry,
  TIMEOUT_BOOKED_ONCE,
} from './proof-10-timeout-retry';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

installCleanup();

const detail = (
  b: ProofBuilder,
  h: { ctx: Parameters<ProofBuilder['build']>[0] },
  id: string
) => b.build(h.ctx).findings.find((f) => f.id === id);

describe('S8 earlier movement bleeding into a later step', () => {
  it('a late deposit makes the fund verdict unknown', async () => {
    const { dispose, ctx, state, mock } = makeHarness({ maxPolls: 6 });
    try {
      await setupScenario(ctx);
      const main = state.mainWalletId as string;
      const goal = state.goalWalletId as string;
      const ledger = new MovementLedger();
      const b = new ProofBuilder('p10', 'S8');
      mock.sandbox.options.balanceLagReads = 16;
      await stepDeposit(ctx, b, main, ledger);
      expect(detail(b, { ctx }, DEPOSIT_ONCE)?.answer).toBe('unknown');
      expect(ledger.isQuiet(main)).toBe(false);
      mock.sandbox.options.balanceLagReads = 0;
      await stepFundGoal(ctx, b, main, goal, ledger);
      const fund = detail(b, { ctx }, FUND_GOAL);
      expect(fund?.answer).toBe('unknown');
      expect(fund?.detail).toBe(EARLIER_UNSETTLED);
    } finally {
      dispose();
    }
  });

  it('a late fund makes the timeout booking unknown', async () => {
    const h = makeHarness({ maxPolls: 6 });
    try {
      await setupScenario(h.ctx);
      const main = h.state.mainWalletId as string;
      const goal = h.state.goalWalletId as string;
      const ledger = new MovementLedger();
      const b = new ProofBuilder('p10', 'S8');
      h.mock.sandbox.options.balanceLagReads = 16;
      const fund = await stepFundGoal(h.ctx, b, main, goal, ledger);
      expect(fund?.mainDeltaKobo).toBeNull();
      h.mock.sandbox.options.balanceLagReads = 0;
      expect(ledger.isQuiet(main, goal)).toBe(false);
      await stepTimeoutRetry(h.ctx, b, main, goal, ledger);
      const booked = detail(b, h, TIMEOUT_BOOKED_ONCE);
      expect(booked?.answer).toBe('unknown');
      expect(booked?.detail).toBe(EARLIER_UNSETTLED);
    } finally {
      h.dispose();
    }
  });

  it('a late repeat makes the timeout booking unknown', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    const ledger = new MovementLedger();
    h.mock.sandbox.options.balanceLagReads = 8;
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund, ledger)).toBe(false);
    expect(ledger.isQuiet(main, goal)).toBe(false);
    h.mock.sandbox.options.balanceLagReads = 0;
    await stepTimeoutRetry(h.ctx, b, main, goal, ledger);
    const booked = detail(b, h, TIMEOUT_BOOKED_ONCE);
    expect(booked?.answer).toBe('unknown');
    expect(booked?.detail).toBe(EARLIER_UNSETTLED);
  });

  it('a not-ledger main makes the double-tap money verdict unknown', async () => {
    const { h, b, main, goal, fund } = await setup();
    const ledger = new MovementLedger();
    ledger.append({ from: null, to: main, amountKobo: 1, settled: false });
    await stepDoubleTap(h.ctx, b, main, goal, fund, ledger);
    const tap = detail(b, h, TAP_ONCE);
    expect(tap?.answer).toBe('unknown');
    expect(tap?.detail).toBe(EARLIER_UNSETTLED);
  });

  it('returns false, not undefined, when the wire repeat was already used', async () => {
    const { h, b, main, goal, fund } = await setup();
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    const ledger = new MovementLedger();
    const again = new ProofBuilder('p10', 'S8');
    const settled = await stepDoubleTap(h.ctx, again, main, goal, fund, ledger);
    expect(settled).toBe(false);
    expect(ledger.isQuiet(main, goal)).toBe(false);
    expect(detail(again, h, TAP_ONCE)?.answer).toBe('unknown');
  });

  it('an unexplained credit during the repeat does not reconcile it', async () => {
    const { h, b, main, goal, fund } = await setup();
    const wallet = h.mock.sandbox.wallet(main);
    if (wallet) wallet.balance += 500;
    const ledger = new MovementLedger();
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund, ledger)).toBe(false);
    expect(ledger.isQuiet(main, goal)).toBe(false);
  });

  it('a repeat whose goal credit lags is not reconciled and keeps the timeout unknown', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    const goalWallet = h.mock.sandbox.wallet(goal);
    if (goalWallet)
      goalWallet.staleBalance = { value: goalWallet.balance, readsLeft: 500 };
    const ledger = new MovementLedger();
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund, ledger)).toBe(false);
    expect(ledger.isQuiet(goal)).toBe(false);
    if (goalWallet) goalWallet.staleBalance = null;
    await stepTimeoutRetry(h.ctx, b, main, goal, ledger);
    const booked = detail(b, h, TIMEOUT_BOOKED_ONCE);
    expect(booked?.answer).toBe('unknown');
    expect(booked?.detail).toBe(EARLIER_UNSETTLED);
  });

  it('unobserved setup funding makes the deposit verdict unknown', async () => {
    const h = makeHarness({ maxPolls: 6 });
    try {
      h.mock.sandbox.options.balanceLagReads = 16;
      const ledger = new MovementLedger();
      await setupScenario(h.ctx, ledger);
      h.mock.sandbox.options.balanceLagReads = 0;
      const main = h.state.mainWalletId as string;
      expect(ledger.isQuiet(main)).toBe(false);
      const b = new ProofBuilder('p10', 'S8');
      await stepDeposit(h.ctx, b, main, ledger);
      const deposit = detail(b, h, DEPOSIT_ONCE);
      expect(deposit?.answer).toBe('unknown');
      expect(deposit?.detail).toBe(EARLIER_UNSETTLED);
    } finally {
      h.dispose();
    }
  });
});
