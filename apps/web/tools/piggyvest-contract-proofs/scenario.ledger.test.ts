import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { MovementLedger } from './movement-ledger';
import { DEPOSIT_ONCE, stepDeposit } from './proof-10-deposit';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});

describe('setupScenario records its funding in the movement ledger', () => {
  it('appends a settled deposit into main once the credit is seen', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    const ledger = new MovementLedger();
    await setupScenario(h.ctx, ledger);
    expect(ledger.entries()).toEqual([
      {
        from: null,
        to: h.state.mainWalletId,
        amountKobo: AMOUNTS_KOBO.fundMain,
        settled: true,
      },
    ]);
    expect(ledger.isQuiet(h.state.mainWalletId as string)).toBe(true);
  });

  it('appends an unsettled deposit when the credit stays invisible', async () => {
    const h = makeHarness({ maxPolls: 6 });
    dispose = h.dispose;
    h.mock.sandbox.options.balanceLagReads = 16;
    const ledger = new MovementLedger();
    await setupScenario(h.ctx, ledger);
    expect(ledger.entries().map((m) => m.settled)).toEqual([false]);
    expect(ledger.isQuiet(h.state.mainWalletId as string)).toBe(false);
  });

  it('appends an unsettled deposit when the funding slot was resumed', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const wallet = h.mock.sandbox.wallet(main);
    if (wallet) wallet.balance = 0;
    const ledger = new MovementLedger();
    await setupScenario(h.ctx, ledger);
    expect(ledger.entries().map((m) => m.settled)).toEqual([false]);
  });
});

describe('setupScenario funding that arrives in two tranches', () => {
  /**
   * Funding credits nothing at first; the sleep hook then lands a first
   * tranche, and (optionally) the remainder `remainderAtSleep` sleeps later.
   */
  async function twoTranches(remainderAtSleep: number | null) {
    const h = makeHarness();
    dispose = h.dispose;
    h.mock.sandbox.options.fundingSettles = false;
    const sandbox = h.mock.sandbox;
    let sleeps = 0;
    const tranche = AMOUNTS_KOBO.fundMain * 0.4;
    h.ctx.sleep = async () => {
      sleeps += 1;
      const main = sandbox.wallet(h.state.mainWalletId);
      if (!main) return;
      if (sleeps === 1) main.balance += tranche;
      if (sleeps === remainderAtSleep)
        main.balance += AMOUNTS_KOBO.fundMain - tranche;
    };
    const ledger = new MovementLedger();
    await setupScenario(h.ctx, ledger);
    sandbox.options.fundingSettles = true;
    return { h, ledger };
  }

  it('does not mark setup funding settled after only the first tranche', async () => {
    const { h, ledger } = await twoTranches(null);
    expect(ledger.entries().map((m) => m.settled)).toEqual([false]);
    expect(ledger.isQuiet(h.state.mainWalletId as string)).toBe(false);
  });

  it('keeps the deposit verdict unknown when the remainder lands in its window', async () => {
    const { h, ledger } = await twoTranches(9);
    const b = new ProofBuilder('p10', 'S8');
    await stepDeposit(h.ctx, b, h.state.mainWalletId as string, ledger);
    const finding = b.build(h.ctx).findings.find((f) => f.id === DEPOSIT_ONCE);
    expect(finding?.answer).toBe('unknown');
  });

  it('marks funding settled once the funded level is reached and holds still', async () => {
    const { ledger } = await twoTranches(2);
    expect(ledger.entries().map((m) => m.settled)).toEqual([true]);
  });
});
