import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { MovementLedger } from './movement-ledger';
import { creditedOnce, DEPOSIT_ONCE, stepDeposit } from './proof-10-deposit';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const b = new ProofBuilder('p10', 'S8');
  await stepDeposit(h.ctx, b, h.state.mainWalletId as string);
  return { h, result: b.build(h.ctx) };
}
const answer = (r: { findings: { id: string; answer: string }[] }) =>
  r.findings.find((f) => f.id === DEPOSIT_ONCE)?.answer;

describe('creditedOnce', () => {
  it('is yes for the gross and for the gross minus a known fee', () => {
    expect(creditedOnce(100, 100, null)).toBe('yes');
    expect(creditedOnce(100, 95, 5)).toBe('yes');
  });
  it('is no for a credit above the gross (a double credit)', () => {
    expect(creditedOnce(100, 200, null)).toBe('no');
    expect(creditedOnce(100, 101, 5)).toBe('no');
  });
  it('is no for a credit that matches neither, and unknown when no fee is known', () => {
    expect(creditedOnce(100, 90, 5)).toBe('no');
    expect(creditedOnce(100, 90, null)).toBe('unknown');
  });
});

describe('S8 deposit step', () => {
  it('records a deposit credited once in the sandbox mock', async () => {
    const { result, h } = await run();
    expect(answer(result)).toBe('yes');
    expect(result.values.deposit_gross_kobo).toBe(AMOUNTS_KOBO.s8DepositMain);
    const deposits = h.mock.calls.filter(
      (c) =>
        c.method === 'POST' && c.pathname.endsWith('/transfer/test/funding')
    );
    // scenario funding + this one deposit: the step sent exactly one.
    expect(deposits).toHaveLength(2);
  });

  it('answers unknown, never yes, when the deposit does not settle', async () => {
    const { result } = await run({ mock: { fundingSettles: false } });
    expect(answer(result)).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('never resends a deposit slot that already ran', async () => {
    const { h } = await run();
    const before = h.mock.calls.filter((c) => c.method === 'POST').length;
    const b = new ProofBuilder('p10', 'S8');
    await stepDeposit(h.ctx, b, h.state.mainWalletId as string);
    expect(h.mock.calls.filter((c) => c.method === 'POST')).toHaveLength(
      before
    );
    expect(answer(b.build(h.ctx))).toBe('unknown');
  });

  it('marks the movement settled when the full credit lands', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const ledger = new MovementLedger();
    await stepDeposit(h.ctx, new ProofBuilder('p10', 'S8'), main, ledger);
    expect(ledger.isQuiet(main)).toBe(true);
  });

  it('keeps a partially visible deposit unsettled in the ledger', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const funding = h.api.fundWallet.bind(h.api);
    let funded = false;
    h.api.fundWallet = async (...args) => {
      funded = true;
      return funding(...args);
    };
    const real = h.api.wallet.bind(h.api);
    h.api.wallet = async (id) => {
      const call = await real(id);
      const data = (call.data ?? {}) as { balance?: number };
      // 100,000 of the 170,000 net credit has not shown yet, and holds still.
      return funded && typeof data.balance === 'number'
        ? { ...call, data: { ...data, balance: data.balance - 100_000 } }
        : call;
    };
    const ledger = new MovementLedger();
    await stepDeposit(h.ctx, new ProofBuilder('p10', 'S8'), main, ledger);
    expect(ledger.isQuiet(main)).toBe(false);
  });
});
