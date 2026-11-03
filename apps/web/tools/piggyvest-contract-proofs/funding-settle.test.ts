import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { fundingSettled } from './funding-settle';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});

describe('fundingSettled', () => {
  it('accepts a credit net of the fee the record shows, once it holds still', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    // Setup funded 1_000_000 less a 5_000 fee: judged against a zero start.
    expect(await fundingSettled(h.ctx, main, 0, AMOUNTS_KOBO.fundMain)).toBe(
      true
    );
  });

  it('rejects a balance below the funded level even when it holds still', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    expect(
      await fundingSettled(h.ctx, main, 0, AMOUNTS_KOBO.fundMain * 3)
    ).toBe(false);
  });

  it('rejects a balance that is still moving at the end of the window', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const wallet = h.mock.sandbox.wallet(main);
    h.ctx.sleep = async () => {
      if (wallet) wallet.balance += 1;
    };
    expect(await fundingSettled(h.ctx, main, 0, AMOUNTS_KOBO.fundMain)).toBe(
      false
    );
  });
});
