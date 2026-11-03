import { describe, expect, it } from 'vitest';
import { compareRun } from './oracle-compare.test-support';
import { mulberry32, scenarioFor } from './oracle-scenarios.test-support';
import {
  resolvedOptions,
  type TruthContext,
} from './oracle-truth.test-support';
import { runProof1 } from './proof-1-return-if-exist';
import { runProof2 } from './proof-2-tsq';
import { runProof3 } from './proof-3-goal-deposit';
import { runProof4 } from './proof-4-withdrawal-counter';
import { runProof5 } from './proof-5-interest';
import { runProof6 } from './proof-6-fees';
import { runProof7 } from './proof-7-interest-routing';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

const PROOFS = [
  runProof1,
  runProof2,
  runProof3,
  runProof4,
  runProof5,
  runProof6,
  runProof7,
];
const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1);

async function runSeed(
  seed: number
): Promise<{ problems: string[]; goalWalletFound: boolean }> {
  const scenario = scenarioFor(seed);
  const h = makeHarness({ mock: scenario.mock, maxPolls: scenario.maxPolls });
  const results: ProofResult[] = [];
  const problems: string[] = [];
  let mainRows = 0;
  let qaWallets = 0;
  let goalWalletFound = false;
  try {
    await setupScenario(h.ctx);
    goalWalletFound = h.state.goalWalletId !== null;
    qaWallets = h.mock.sandbox.wallets.filter(
      (wallet) => wallet.customerId === h.state.customerId
    ).length;
    for (const run of PROOFS) {
      if (run === runProof5) {
        mainRows = h.mock.sandbox.ledger.rowCount(h.state.mainWalletId ?? '');
      }
      try {
        results.push(await run(h.ctx));
      } catch (error) {
        problems.push(
          `a proof threw: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const ctx: TruthContext = {
      o: resolvedOptions(scenario.mock),
      mainRows,
      qaWallets,
    };
    problems.push(...compareRun(results, ctx));
    problems.push(
      ...h.redactor
        .leaks(JSON.stringify(results))
        .map((leak) => `leak: ${leak}`)
    );
  } finally {
    h.dispose();
  }
  return {
    goalWalletFound,
    problems: problems.map(
      (problem) =>
        `seed ${seed}: ${problem} [${JSON.stringify({ maxPolls: scenario.maxPolls, ...scenario.mock })}]`
    ),
  };
}

describe('ground-truth oracle: the seeded scenarios themselves', () => {
  it('are deterministic: a seed always produces the same scenario', () => {
    for (const seed of [1, 7, 150]) {
      expect(scenarioFor(seed)).toEqual(scenarioFor(seed));
    }
    expect(mulberry32(5)()).toBe(mulberry32(5)());
    expect(scenarioFor(1)).not.toEqual(scenarioFor(2));
  });

  it('cover every kind of turbulence and every kind of behaviour across the seed list', () => {
    const all = SEEDS.map((seed) => scenarioFor(seed).mock);
    const seen = (test: (mock: (typeof all)[number]) => boolean) =>
      all.some(test);
    expect(seen((m) => (m.balanceLagReads ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.listLagReads ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.settingsLagReads ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.payoutFieldLagReads ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.counterLagReads ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.counterLagReadsGoal ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.serverErrorPaths?.length ?? 0) > 0)).toBe(true);
    expect(seen((m) => (m.flakyPaths?.length ?? 0) > 0)).toBe(true);
    expect(seen((m) => m.serverErrorData != null)).toBe(true);
    expect(seen((m) => (m.failNetworkOnce?.length ?? 0) > 0)).toBe(true);
    expect(seen((m) => m.tsqSettleEarly === true)).toBe(true);
    expect(seen((m) => (m.goalInterestRate ?? 0) > 0)).toBe(true);
    expect(seen((m) => m.pagingMode === 'rotating_cursor_same_rows')).toBe(
      true
    );
    expect(seen((m) => m.pagingMode === 'stuck_cursor')).toBe(true);
    expect(seen((m) => m.w2wIncrementsCounter === true)).toBe(true);
    expect(seen((m) => m.counterScope === 'customer')).toBe(true);
    expect(seen((m) => m.payoutReadback === 'accrual_only')).toBe(true);
    expect(seen((m) => m.customerPayoutWallet === 'rejected')).toBe(true);
  });
});

describe('ground-truth oracle: the comparison itself bites', () => {
  const ctx: TruthContext = {
    o: resolvedOptions({}),
    mainRows: 3,
    qaWallets: 2,
  };
  const result = (over: Partial<ProofResult>): ProofResult => ({
    proof: 'p4',
    title: 't',
    status: 'observed',
    findings: [],
    shapes: [],
    values: {},
    notes: [],
    ...over,
  });
  const finding = (id: string, answer: 'yes' | 'no' | 'unknown') => ({
    id,
    question: id,
    answer,
  });

  it('accepts a correct answer and an honest unknown', () => {
    expect(
      compareRun(
        [
          result({
            findings: [finding('w2w_changes_counter', 'no')],
          }),
          result({
            status: 'inconclusive',
            findings: [finding('bank_outflow_changes_counter', 'unknown')],
          }),
        ],
        ctx
      )
    ).toEqual([]);
  });

  it('flags a wrong answer', () => {
    expect(
      compareRun(
        [result({ findings: [finding('w2w_changes_counter', 'yes')] })],
        ctx
      )
    ).toEqual(['p4 w2w_changes_counter: answered yes, truth no']);
  });

  it('flags an observed proof that holds an unknown finding, but not an unobservable one', () => {
    expect(
      compareRun(
        [
          result({
            findings: [finding('bank_outflow_changes_counter', 'unknown')],
          }),
        ],
        ctx
      )
    ).toHaveLength(1);
    expect(
      compareRun(
        [
          result({
            findings: [finding('webhook_names_goal_wallet', 'unknown')],
          }),
        ],
        ctx
      )
    ).toEqual([]);
  });

  it('flags a claim about something the scenario makes unobservable, and an unmapped finding', () => {
    expect(
      compareRun(
        [result({ findings: [finding('webhook_names_goal_wallet', 'no')] })],
        ctx
      )
    ).toHaveLength(1);
    expect(
      compareRun(
        [result({ findings: [finding('brand_new_finding', 'yes')] })],
        ctx
      )
    ).toEqual(['p4 brand_new_finding: no ground truth defined']);
  });

  it('flags a published measurement that contradicts the truth, and ignores nulls', () => {
    expect(
      compareRun([result({ values: { counter_scope: 'per_customer' } })], ctx)
    ).toHaveLength(1);
    expect(
      compareRun(
        [
          result({
            values: {
              counter_scope: null,
              interest_rate_nonzero_on_any_wallet: false,
            },
          }),
        ],
        ctx
      )
    ).toEqual([]);
  });
});

describe('ground-truth oracle: every seeded run', () => {
  it('only ever answers what the sandbox truly does, and is never observed with an unknown it depends on', async () => {
    const problems: string[] = [];
    let goalWallets = 0;
    for (const seed of SEEDS) {
      const run = await runSeed(seed);
      problems.push(...run.problems);
      if (run.goalWalletFound) goalWallets += 1;
    }
    expect(problems).toEqual([]);
    // A goal wallet the harness cannot find only turns findings `unknown`,
    // which the checks above accept. The mock renames wallets as the live
    // sandbox does (2026-10-31), so most runs must still find theirs.
    // 192/200 seeds do today (the rest drop the create or the list on
    // purpose); an exact name lookup finds 0.
    expect(goalWallets).toBeGreaterThan(SEEDS.length * 0.8);
  }, 600_000);
});
