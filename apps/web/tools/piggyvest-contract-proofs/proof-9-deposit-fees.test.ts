import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runProof3 } from './proof-3-goal-deposit';
import { bindingOf, runProof9 } from './proof-9-deposit-fees';
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
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;
const fundings = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/transfer/test/funding'
  ).length;

async function run(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  await runProof3(h.ctx);
  const before = fundings(h);
  const result = await runProof9(h.ctx);
  return { h, result, sent: fundings(h) - before };
}

describe('proof 9: deposit fee mechanics', () => {
  it('measures a main deposit next to the goal deposit and binds a netted fee', async () => {
    const { h, result, sent } = await run();
    expect(sent).toBe(1);
    expect(result.status).toBe('observed');
    expect(answer(result, 'main_deposit_credited')).toBe('yes');
    expect(answer(result, 'main_deposit_record_shows_fee')).toBe('yes');
    expect(answer(result, 'main_deposit_record_amount_is_gross')).toBe('yes');
    expect(answer(result, 'goal_deposit_measured')).toBe('yes');
    expect(answer(result, 'deposit_fee_netted_from_credit')).toBe('yes');
    expect(answer(result, 'deposit_event_gross_fee_net')).toBe('unknown');
    expect(result.values).toMatchObject({
      main_deposit_fee_kobo: 5_000,
      main_credit_relation: 'net_of_fee',
      goal_deposit_fee_kobo: 5_000,
      goal_credit_relation: 'net_of_fee',
      deposit_fee_binding: 'net_of_fee',
    });
    expect(String(result.values.main_deposit_record_money_fields)).toContain(
      'fee'
    );
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });

  it('records the binding as unproven when the sandbox charges no deposit fee', async () => {
    const { result } = await run({ mock: { depositFeeKobo: 0 } });
    expect(result.values.deposit_fee_binding).toBe('unproven_zero_fee');
    const finding = result.findings.find(
      (f) => f.id === 'deposit_fee_netted_from_credit'
    );
    expect(finding?.answer).toBe('unknown');
    expect(finding?.detail).toMatch(/no deposit fee/);
    expect(result.status).toBe('observed');
  });

  it('tells a fee billed elsewhere from a netted one', async () => {
    const { result } = await run({ mock: { depositFeeBorneByWallet: false } });
    expect(result.values.deposit_fee_binding).toBe(
      'gross_fee_billed_elsewhere'
    );
    expect(answer(result, 'deposit_fee_netted_from_credit')).toBe('no');
  });

  it('is inconclusive without a measured goal deposit', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const result = await runProof9(h.ctx);
    expect(answer(result, 'goal_deposit_measured')).toBe('unknown');
    expect(result.values.deposit_fee_binding).toBe('unknown');
    expect(result.status).toBe('inconclusive');
  });

  it('never re-funds on a re-run, and sends nothing in read-only mode', async () => {
    const journal = createMemoryJournal();
    const first = await run({ journal });
    const sandbox = first.h.mock.sandbox;
    first.h.dispose();
    const h = harness({ journal });
    h.mock.sandbox.adopt(sandbox);
    await setupScenario(h.ctx);
    const before = fundings(h);
    const result = await runProof9(h.ctx);
    expect(fundings(h)).toBe(before);
    expect(result.status).toBe('inconclusive');
    h.dispose();

    const readonly = harness({ mode: 'live-readonly' });
    await setupScenario(readonly.ctx);
    expect((await runProof9(readonly.ctx)).status).toBe('inconclusive');
    expect(fundings(readonly)).toBe(0);
  });
});

describe('bindingOf', () => {
  const net = { grossKobo: 100, creditedKobo: 95, feeKobo: 5 };
  const gross = { grossKobo: 100, creditedKobo: 100, feeKobo: 5 };
  it('needs both deposits with a readable fee', () => {
    expect(bindingOf([net, null])).toBe('unknown');
    expect(bindingOf([net, { ...gross, feeKobo: null }])).toBe('unknown');
  });
  it('binds only on the deposits that carried a fee, and calls a split mixed', () => {
    expect(
      bindingOf([net, { grossKobo: 100, creditedKobo: 100, feeKobo: 0 }])
    ).toBe('net_of_fee');
    expect(bindingOf([net, gross])).toBe('mixed');
    expect(bindingOf([gross, gross])).toBe('gross_fee_billed_elsewhere');
  });
});
