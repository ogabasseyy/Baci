import { afterEach, describe, expect, it } from 'vitest';
import { readingOf, settledWallets } from './poll';
import type { CallResult } from './provider-ops';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}

const _call = (over: Partial<CallResult>): CallResult => ({
  ok: true,
  httpStatus: 200,
  data: undefined,
  envelope: null,
  message: null,
  declined: false,
  errorCode: null,
  typedAccepted: null,
  ...over,
});

describe('settledWallets', () => {
  it('is settled when nothing moves, and reads for the whole budget', async () => {
    const h = harness({ maxPolls: 4 });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    const before = h.mock.calls.length;
    const settled = await settledWallets(h.ctx, [main]);
    expect(settled.settled).toBe(true);
    expect(readingOf(settled, main).balance).toBeGreaterThan(0);
    // one read now plus one per polling round
    expect(h.mock.calls.length - before).toBe(5);
  });

  it('is not settled while a balance is still changing in the final round', async () => {
    const h = harness({ maxPolls: 3 });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    const original = h.api.wallet.bind(h.api);
    let reads = 0;
    h.api.wallet = async (id) => {
      reads += 1;
      const read = await original(id);
      const data = (read.data ?? {}) as Record<string, unknown>;
      return { ...read, data: { ...data, balance: 1000 + reads } };
    };
    expect((await settledWallets(h.ctx, [main])).settled).toBe(false);
  });

  it('is settled once a late change has landed and held for the final round', async () => {
    const h = harness({ maxPolls: 4, mock: { balanceLagReads: 2 } });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    h.mock.sandbox.ledger.fund({ wallet_id: main, amount: 100_000 });
    const before = readingOf(await settledWallets(h.ctx, [main]), main);
    expect(before.balance).toBeGreaterThan(0);
    const after = await settledWallets(h.ctx, [main]);
    expect(after.settled).toBe(true);
    expect(readingOf(after, main).balance).toBe(before.balance);
  });

  it('is not settled when a balance cannot be read, and an unread wallet reads as null', async () => {
    const h = harness({ maxPolls: 2 });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/wallet/01M2T'];
    const down = await settledWallets(h.ctx, [main]);
    expect(down.settled).toBe(false);
    expect(readingOf(down, main).balance).toBeNull();
    expect(readingOf(down, 'never-asked')).toEqual({
      balance: null,
      withdrawalCount: null,
    });
  });
});
