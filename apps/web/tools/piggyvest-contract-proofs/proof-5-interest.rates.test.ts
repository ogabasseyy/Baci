import { afterEach, describe, expect, it } from 'vitest';
import { runProof5 } from './proof-5-interest';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const _answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;

describe('proof 5: "no nonzero rate" needs every wallet read', () => {
  async function withRates(
    rates: Record<'main' | 'goal', number | 'fail' | 'omit'>
  ) {
    const h = harness();
    await setupScenario(h.ctx);
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) => {
      const read = await original(walletId);
      const role = walletId === h.state.mainWalletId ? 'main' : 'goal';
      const rate = rates[role];
      if (rate === 'fail')
        return { ...read, ok: false, httpStatus: 503, data: undefined };
      const data =
        read.data !== null && typeof read.data === 'object' ? read.data : {};
      const { current_interest_rate: _drop, ...rest } = data as Record<
        string,
        unknown
      >;
      return {
        ...read,
        data: rate === 'omit' ? rest : { ...rest, current_interest_rate: rate },
      };
    };
    return runProof5(h.ctx);
  }
  const flag = (result: ProofResult) =>
    result.values.interest_rate_nonzero_on_any_wallet;

  it('is false only when every wallet was read and every rate is zero', async () => {
    expect(flag(await withRates({ main: 0, goal: 0 }))).toBe(false);
  });

  it('is null when one wallet reads zero and the other fails or omits its rate', async () => {
    expect(flag(await withRates({ main: 0, goal: 'fail' }))).toBeNull();
    expect(flag(await withRates({ main: 0, goal: 'omit' }))).toBeNull();
  });

  it('is true as soon as one readable wallet has a positive rate', async () => {
    expect(flag(await withRates({ main: 0.05, goal: 'fail' }))).toBe(true);
    expect(flag(await withRates({ main: 0, goal: 0.02 }))).toBe(true);
  });
});
