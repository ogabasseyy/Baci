import { afterEach, describe, expect, it, vi } from 'vitest';
import { MovementLedger } from './movement-ledger';
import {
  stepTimeoutRetry,
  TIMEOUT_BOOKED_ONCE,
} from './proof-10-timeout-retry';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
const urlOf = (h: ReturnType<typeof makeHarness>) => h.mock.calls;
const posts = (h: ReturnType<typeof makeHarness>) =>
  urlOf(h).filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/wallet'
  );

async function run(
  options: Parameters<typeof makeHarness>[0] = {},
  earlierSettled = true
) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const b = new ProofBuilder('p10', 'S8');
  const before = posts(h).length;
  const ledger = new MovementLedger();
  if (!earlierSettled)
    ledger.append({
      from: null,
      to: h.state.mainWalletId as string,
      amountKobo: 1,
      settled: false,
    });
  await stepTimeoutRetry(
    h.ctx,
    b,
    h.state.mainWalletId as string,
    h.state.goalWalletId as string,
    ledger
  );
  return { h, b, result: b.build(h.ctx), before };
}
const answer = (
  r: { findings: { id: string; answer: string }[] },
  id: string
) => r.findings.find((f) => f.id === id)?.answer;

describe('S8 timeout booking with a lagging balance', () => {
  it('answers unknown, not no, when the balance never shows the booking', async () => {
    const { result } = await run({
      mock: { balanceLagReads: 8 },
      maxPolls: 6,
    });
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('unknown');
    expect(result.values.timeout_main_delta_kobo).toBeNull();
  });

  it('answers unknown while an earlier transfer is still unsettled', async () => {
    const { result } = await run({}, false);
    expect(answer(result, TIMEOUT_BOOKED_ONCE)).toBe('unknown');
  });

  it('answers unknown when the goal credit is short and no fee was read', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const goal = h.state.goalWalletId as string;
    const goalWallet = h.mock.sandbox.wallet(goal);
    const real = h.ctx.api.verify.bind(h.ctx.api);
    let taken = false;
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      const out = await real(...args);
      if (goalWallet && !taken && out.httpStatus === 200) {
        taken = true;
        goalWallet.balance -= 100;
      }
      return out;
    };
    const b = new ProofBuilder('p10', 'S8');
    await stepTimeoutRetry(h.ctx, b, main, goal);
    expect(answer(b.build(h.ctx), TIMEOUT_BOOKED_ONCE)).toBe('unknown');
  });

  it('answers unknown when the goal balance never shows the booking', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId as string;
    const goal = h.state.goalWalletId as string;
    const goalWallet = h.mock.sandbox.wallet(goal);
    if (goalWallet)
      goalWallet.staleBalance = { value: goalWallet.balance, readsLeft: 500 };
    const b = new ProofBuilder('p10', 'S8');
    await stepTimeoutRetry(h.ctx, b, main, goal);
    expect(answer(b.build(h.ctx), TIMEOUT_BOOKED_ONCE)).toBe('unknown');
  });
});
