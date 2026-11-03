import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { MovementLedger } from './movement-ledger';
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
