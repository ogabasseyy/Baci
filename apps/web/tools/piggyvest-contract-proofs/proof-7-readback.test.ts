import { afterEach, describe, expect, it, vi } from 'vitest';
import { readbackPayout } from './proof-7-readback';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
async function ready(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  return {
    h,
    main: h.state.mainWalletId ?? '',
    business: h.mock.sandbox.businessWalletId,
  };
}

describe('readbackPayout', () => {
  it('returns the interest facts of a wallet whose settings are visible, in one read', async () => {
    const { h, main, business } = await ready();
    const read = await readbackPayout(h.ctx, main, business);
    expect(read).toMatchObject({ settled: true, polls: 1, httpStatus: 200 });
    expect(read.facts?.interestFieldPaths).toContain('interest_payout_wallet');
    expect(read.facts?.matchesTarget).toEqual([]);
  });

  it('keeps reading within the budget until the settings appear', async () => {
    const { h, main, business } = await ready({ maxPolls: 6 });
    const w = h.mock.sandbox.wallet(main);
    if (!w) throw new Error('wallet missing');
    w.settingsHiddenReads = 3;
    const read = await readbackPayout(h.ctx, main, business);
    expect(read).toMatchObject({ settled: true, polls: 4 });
    expect(read.facts).not.toBeNull();
  });

  it('reports unsettled, with no facts, when the settings never appear in the budget', async () => {
    const { h, main, business } = await ready({ maxPolls: 3 });
    const w = h.mock.sandbox.wallet(main);
    if (!w) throw new Error('wallet missing');
    w.settingsHiddenReads = 50;
    const read = await readbackPayout(h.ctx, main, business);
    expect(read).toMatchObject({ settled: false, facts: null, polls: 4 });
  });

  it('reports unsettled when the readback fails or is not an object', async () => {
    const { h, main, business } = await ready({ maxPolls: 1 });
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (id) => ({
      ...(await original(id)),
      ok: false,
      httpStatus: 503,
      data: undefined,
    });
    const failed = await readbackPayout(h.ctx, main, business);
    expect(failed).toMatchObject({
      settled: false,
      facts: null,
      httpStatus: 503,
    });
    h.api.wallet = async (id) => ({
      ...(await original(id)),
      ok: true,
      data: 'text',
    });
    expect((await readbackPayout(h.ctx, main, business)).facts).toBeNull();
  });

  it('sleeps between reads using the configured interval', async () => {
    const { h, main, business } = await ready({ maxPolls: 2 });
    const w = h.mock.sandbox.wallet(main);
    if (!w) throw new Error('wallet missing');
    w.settingsHiddenReads = 50;
    h.ctx.pollIntervalMs = 25;
    const sleep = vi.fn(async () => undefined);
    h.ctx.sleep = sleep;
    await readbackPayout(h.ctx, main, business);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });
});
