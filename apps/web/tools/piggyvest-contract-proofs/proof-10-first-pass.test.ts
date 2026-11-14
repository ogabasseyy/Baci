import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProof10 } from './proof-10-first-pass';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const mutationPosts = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').length;

const EXPECTED_YES = [
  's8_onboard_customer_and_main_wallet',
  's8_goal_wallet_created',
  's8_deposit_credited_once',
  's8_fund_goal_moves_money_once',
  's8_double_tap_app_sends_once',
  's8_double_tap_exactly_one_transfer',
  's8_timeout_submit_is_indeterminate',
  's8_timeout_tsq_before_any_resend',
  's8_timeout_transfer_booked_once',
];

describe('proof 10: S8 sandbox first pass', () => {
  it('proves every scenario against the mock sandbox', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const result = await runProof10(h.ctx);
    expect(result.proof).toBe('p10');
    expect(result.status).toBe('observed');
    for (const id of EXPECTED_YES) {
      expect(result.findings.find((f) => f.id === id)?.answer, id).toBe('yes');
    }
    expect(
      result.findings.find((f) => f.id === 's8_timeout_not_found_is_uncertain')
        ?.answer
    ).toBe('not_applicable');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('sends exactly: one deposit, one goal funding, one wire repeat and one timed-out transfer', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const before = mutationPosts(h);
    await runProof10(h.ctx);
    const paths = h.mock.calls
      .filter((c) => c.method === 'POST')
      .slice(before)
      .map((c) => c.pathname);
    expect(paths).toEqual([
      // proof 10 runs on its own customer: create, goal wallet, funding
      '/api/v1/customers',
      '/api/v1/wallet/sub-account',
      '/api/v1/transfer/test/funding',
      '/api/v1/transfer/test/funding',
      '/api/v1/transfer/wallet', // fund goal
      '/api/v1/transfer/wallet', // wire-level second tap, same reference
      '/api/v1/transfer/wallet', // timeout on submit
    ]);
  });

  it('is fully resumable: a plain re-run in the same journal sends nothing', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    await runProof10(h.ctx);
    const before = mutationPosts(h);
    const again = await runProof10(h.ctx);
    expect(mutationPosts(h)).toBe(before);
    expect(again.status).toBe('inconclusive');
  });

  it('sends nothing in live-readonly and leaves every mutation finding unknown', async () => {
    const h = harness({ mode: 'live-readonly' });
    await setupScenario(h.ctx);
    const result = await runProof10(h.ctx);
    expect(mutationPosts(h)).toBe(0);
    expect(result.status).toBe('inconclusive');
    expect(
      result.findings.find((f) => f.id === 's8_timeout_submit_is_indeterminate')
        ?.answer
    ).toBe('unknown');
  });

  it('keeps going and reports a 404 right after submit as uncertain', async () => {
    const h = harness({ mock: { tsqNotFoundPolls: 2 } });
    await setupScenario(h.ctx);
    const result = await runProof10(h.ctx);
    expect(result.status).toBe('observed');
    expect(
      result.findings.find((f) => f.id === 's8_timeout_not_found_is_uncertain')
        ?.answer
    ).toBe('yes');
    expect(result.values.timeout_resend_attempts).toBe(0);
  });

  it('reports unreadable onboarding evidence as unknown, never no', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const real = h.ctx.api.customerWallets.bind(h.ctx.api);
    h.ctx.api.customerWallets = async (...args: Parameters<typeof real>) => ({
      ...(await real(...args)),
      ok: false,
      httpStatus: 500,
    });
    const result = await runProof10(h.ctx);
    const answerOf = (id: string) =>
      result.findings.find((f) => f.id === id)?.answer;
    expect(answerOf('s8_onboard_customer_and_main_wallet')).toBe('unknown');
    expect(answerOf('s8_goal_wallet_created')).toBe('unknown');
  });

  it('leaves the timeout booking unknown while the goal funding is still unsettled', async () => {
    const h = harness({ mock: { tsqPendingPolls: 7 }, maxPolls: 6 });
    await setupScenario(h.ctx);
    const result = await runProof10(h.ctx);
    expect(
      result.findings.find((f) => f.id === 's8_timeout_transfer_booked_once')
        ?.answer
    ).toBe('unknown');
  });

  it('measures on its own wallets, so movement on the shared scenario wallets cannot bleed in', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const sharedMain = h.state.mainWalletId as string;
    const sharedGoal = h.state.goalWalletId as string;
    const shared = h.mock.sandbox.wallet(sharedMain);
    const real = h.ctx.api.verify.bind(h.ctx.api);
    // Something earlier keeps crediting the shared main wallet.
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => {
      if (shared) shared.balance += 777;
      return real(...args);
    };
    const result = await runProof10(h.ctx);
    for (const id of EXPECTED_YES) {
      expect(result.findings.find((f) => f.id === id)?.answer, id).toBe('yes');
    }
    expect(h.state.mainWalletId).toBe(sharedMain);
    expect(h.state.goalWalletId).toBe(sharedGoal);
  });
});
