import { afterEach, describe, expect, it } from 'vitest';
import { recordGoalWallets } from './proof-7-goals';
import {
  disposeGoalHarness,
  ownGoalHarness,
  runGoals,
} from './proof-7-goals.test-support';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

afterEach(disposeGoalHarness);

describe('recordGoalWallets', () => {
  it('records created, accepted and named-destination findings on the happy path; a null payout leaves inheritance unproven', async () => {
    const { answer, result } = await runGoals();
    expect(answer('goal_without_payout_created')).toBe('yes');
    // Goal (a) reads back payout null: that proves nothing either way.
    expect(answer('goal_without_payout_inherits_business_payout')).toBe(
      'unknown'
    );
    expect(
      result.findings.find(
        (f) => f.id === 'goal_without_payout_inherits_business_payout'
      )?.detail
    ).toMatch(/in writing/);
    expect(result.notes.join(' ')).not.toMatch(/INHERITS/);
    expect(answer('goal_explicit_payout_accepted')).toBe('yes');
    expect(answer('goal_explicit_readback_names_payout_destination')).toBe(
      'yes'
    );
    // Sub-wallet creation answers 202 "processing", as the live sandbox did.
    expect(result.values.goal_d_http_status).toBe(202);
    expect(answer('goal_opted_out_created')).toBe('yes');
    expect(answer('goal_opted_out_reads_accrual_off')).toBe('yes');
    expect(answer('goal_payout_main_accepted')).toBe('yes');
    expect(answer('goal_payout_update_after_creation_documented')).toBe('no');
    expect(result.status).toBe('observed');
  });

  it('records each variant at 0 and 5 minutes as pseudonyms with its verdict', async () => {
    const { result } = await runGoals();
    const row = (id: string) =>
      [
        'http_status',
        'outcome',
        'interest_enabled_at_0m',
        'payout_at_0m',
        'interest_enabled_at_5m',
        'payout_at_5m',
        'verdict',
      ].map((field) => result.values[`goal_${id}_${field}`]);
    expect(row('a')).toEqual([
      202,
      'accepted',
      true,
      'null',
      true,
      'null',
      'not_proven',
    ]);
    expect(row('b')).toEqual([
      202,
      'accepted',
      false,
      'null',
      false,
      'null',
      'not_proven',
    ]);
    expect(row('c')).toEqual([
      202,
      'accepted',
      true,
      'main',
      true,
      'main',
      'not_proven',
    ]);
    expect(row('d')).toEqual([
      202,
      'accepted',
      true,
      'business',
      true,
      'business',
      'not_proven',
    ]);
  });

  it('a null payout proves nothing: the stays-in-goal answer is unknown and the owner gets a written question', async () => {
    const { answer, result } = await runGoals();
    for (const id of ['a', 'b']) {
      expect(answer(`goal_${id}_interest_stays_in_goal`)).toBe('unknown');
      expect(
        result.findings.find(
          (f) => f.id === `goal_${id}_interest_stays_in_goal`
        )?.detail
      ).toMatch(/in writing/);
    }
    expect(answer('goal_c_interest_stays_in_goal')).toBe('no');
    expect(answer('goal_d_interest_stays_in_goal')).toBe('no');
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/PiggyVest/);
    expect(notes).toMatch(/0%/);
    expect(notes).toMatch(/\(a\) opted in, payout unset: .*not proven/);
  });

  it('only a readback naming the goal itself proves interest stays in it', async () => {
    const { answer, result } = await runGoals({
      mock: { subWalletPaysItselfWhenUnset: true },
    });
    expect(answer('goal_a_interest_stays_in_goal')).toBe('yes');
    expect(result.values.goal_a_verdict).toBe('proven');
    expect(result.values.goal_a_payout_at_5m).toBe('self');
    expect(result.notes.join(' ')).not.toMatch(/written question/);
    // Goal (b) is opted out: its readback naming itself proves nothing.
    expect(result.values.goal_b_payout_at_5m).toBe('self');
    expect(result.values.goal_b_verdict).toBe('not_proven');
    expect(answer('goal_b_interest_stays_in_goal')).toBe('unknown');
    expect(result.status).toBe('observed');
  });

  it('leaves stays-in-goal unknown, and the proof inconclusive, when the payout field never shows', async () => {
    const { answer, result } = await runGoals({
      mock: { goalReadbackOmitsPayout: true },
    });
    expect(answer('goal_a_interest_stays_in_goal')).toBe('unknown');
    expect(result.values.goal_a_payout_at_5m).toBe('absent');
    expect(result.status).toBe('inconclusive');
  });

  it('warns loudly when a goal wallet inherits the business payout wallet', async () => {
    const { answer, result } = await runGoals(
      { mock: { subWalletInheritsPayout: true } },
      ['interest_payout_wallet'],
      (h) => {
        // The customer carries the business payout wallet, as a proof-7 customer does.
        h.mock.sandbox.customers[0].payoutWalletId =
          h.mock.sandbox.businessWalletId;
      }
    );
    expect(answer('goal_without_payout_inherits_business_payout')).toBe('yes');
    expect(result.notes.join(' ')).toMatch(/INHERITS/);
  });

  it('says no once goal (a) names itself and the main wallet showed the same field', async () => {
    const { answer } = await runGoals({
      mock: { subWalletPaysItselfWhenUnset: true },
    });
    expect(answer('goal_without_payout_inherits_business_payout')).toBe('no');
  });

  it('records the rejection message of an explicit payout, redacted', async () => {
    const { answer, result } = await runGoals({
      mock: { subAccountAcceptsPayout: false },
    });
    expect(answer('goal_explicit_payout_accepted')).toBe('no');
    expect(result.values.goal_d_error_message).toBe(
      'Invalid interest payout wallet'
    );
    expect(answer('goal_without_payout_created')).toBe('yes');
  });

  it('leaves inheritance unknown when the main wallet never named the destination field', async () => {
    const { answer } = await runGoals({}, []);
    expect(answer('goal_without_payout_inherits_business_payout')).toBe(
      'unknown'
    );
  });

  it('leaves every goal finding unknown when there is no QA customer to own the wallets', async () => {
    const h = makeHarness();
    ownGoalHarness(h);
    const b = new ProofBuilder('p7', 'T');
    await recordGoalWallets(
      h.ctx,
      b,
      null,
      h.mock.sandbox.businessWalletId,
      []
    );
    const result = b.build(h.ctx);
    const measured = result.findings.filter(
      (f) => f.id !== 'goal_payout_update_after_creation_documented'
    );
    expect(measured).toHaveLength(11);
    expect(measured.every((f) => f.answer === 'unknown')).toBe(true);
    expect(measured.every((f) => f.detail === 'no QA customer available')).toBe(
      true
    );
    expect(h.mock.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('marks the proof inconclusive and explains it when a sub-wallet slot was already executed', async () => {
    const first = await runGoals();
    const { customers, wallets } = first.h.mock.sandbox;
    const journal = first.h.journal;
    first.h.dispose();
    const h = makeHarness({ journal, runId: 'run2' });
    ownGoalHarness(h);
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const b = new ProofBuilder('p7', 'T');
    await recordGoalWallets(
      h.ctx,
      b,
      {
        qa: h.ctx.qa,
        customerId: h.state.customerId ?? '',
        mainWalletId: h.state.mainWalletId,
      },
      h.mock.sandbox.businessWalletId,
      ['interest_payout_wallet']
    );
    const result = b.build(h.ctx);
    expect(result.status).toBe('inconclusive');
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
  });
});
