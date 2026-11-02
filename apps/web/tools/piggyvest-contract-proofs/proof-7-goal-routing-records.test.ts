import { afterEach, describe, expect, it } from 'vitest';
import {
  GOAL_ROUTING_VARIANTS,
  type GoalRoutingReading,
  type GoalRoutingVariant,
  type PayoutPseudonym,
} from './goal-interest-routing';
import type { GoalRoutingRun } from './proof-7-goal-routing';
import {
  NO_ACCRUAL_DETAIL,
  OWNER_QUESTION_NAMED_NOTE,
  OWNER_QUESTION_NOTE,
  PSEUDONYM_LEGEND,
  recordRoutingValues,
  recordStaysInGoal,
  routingNotes,
  SANDBOX_RATE_NOTE,
} from './proof-7-goal-routing-records';
import type { GoalVariantResult } from './proof-7-goal-variants';
import { ProofBuilder } from './proof-builder';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

type VariantId = GoalRoutingVariant['id'];
const variant = (id: VariantId): GoalRoutingVariant =>
  GOAL_ROUTING_VARIANTS.find((v) => v.id === id) ?? GOAL_ROUTING_VARIANTS[0];
const reading = (
  payout: PayoutPseudonym,
  interestEnabled: boolean | null = true
): GoalRoutingReading => ({ interestEnabled, payout });
const UNREAD = reading('unread', null);

function result(over: Partial<GoalVariantResult> = {}): GoalVariantResult {
  return {
    exists: true,
    accepted: true,
    httpStatus: 202,
    errorMessage: null,
    resumedOutcome: null,
    readback: null,
    readbackData: null,
    readbackRecord: null,
    walletId: 'wallet-goal-0001',
    ...over,
  };
}

function run(
  id: VariantId,
  res: GoalVariantResult | null,
  atOnce: GoalRoutingReading = UNREAD,
  afterRecheck: GoalRoutingReading = UNREAD
): GoalRoutingRun {
  return {
    variant: variant(id),
    walletName: `goal-${id}`,
    result: res,
    atOnce,
    afterRecheck,
  };
}

/** Records one run the way proof 7 does and returns the built proof. */
function record(routed: GoalRoutingRun) {
  const h = makeHarness();
  dispose = h.dispose;
  const b = new ProofBuilder('p7', 'T');
  recordStaysInGoal(b, routed, 'Does interest stay in the goal?');
  recordRoutingValues(h.ctx, b, routed);
  const built = b.build(h.ctx);
  const id = `goal_${routed.variant.id}_interest_stays_in_goal`;
  return {
    h,
    built,
    values: built.values,
    finding: built.findings.find((f) => f.id === id),
  };
}

describe('recordRoutingValues: outcome, status and the provider message', () => {
  it('a variant that was not sent: not_sent, no HTTP status, and a stays-in-goal answer of unknown', () => {
    const { values, finding, built } = record(run('c', null));
    expect(values.goal_c_outcome).toBe('not_sent');
    expect(values.goal_c_http_status).toBeNull();
    expect(values.goal_c_payout_at_0m).toBe('unread');
    expect(finding).toMatchObject({
      answer: 'unknown',
      detail: "the owner's main wallet is unknown, so it was not sent",
    });
    expect(built.status).toBe('inconclusive');
  });

  it('a resumed slot is "resumed", even when the earlier outcome was accepted', () => {
    const resumed = { resumedOutcome: 'accepted' };
    expect(
      record(run('a', result({ ...resumed, accepted: null }))).values
        .goal_a_outcome
    ).toBe('resumed');
    expect(
      record(run('a', result({ ...resumed, accepted: true }))).values
        .goal_a_outcome
    ).toBe('resumed');
  });

  it('a refused create is "rejected" and carries only the redacted provider message', () => {
    const message = 'Invalid interest payout wallet 1234567 for goal';
    const { h, values } = record(
      run(
        'd',
        result({ accepted: false, httpStatus: 422, errorMessage: message })
      )
    );
    expect(values.goal_d_outcome).toBe('rejected');
    expect(values.goal_d_http_status).toBe(422);
    expect(values.goal_d_error_message).toBe(h.ctx.redactor.message(message));
    expect(values.goal_d_error_message).not.toContain('1234567');
  });

  it('writes no error_message when there is none, and "unknown" when acceptance is unknown', () => {
    const { values } = record(run('d', result({ accepted: null })));
    expect(values.goal_d_outcome).toBe('unknown');
    expect(Object.hasOwn(values, 'goal_d_error_message')).toBe(false);
  });
});

describe('recordStaysInGoal: only a readback naming the goal itself is a yes', () => {
  it('both readings unread: unknown, "the goal could not be read back"', () => {
    const { finding } = record(run('a', result()));
    expect(finding).toMatchObject({
      answer: 'unknown',
      detail: 'the goal could not be read back',
    });
  });

  it('the payout field omitted: unknown, naming the missing field', () => {
    const { finding } = record(run('a', result(), reading('absent')));
    expect(finding).toMatchObject({
      answer: 'unknown',
      detail: 'the goal readback did not show interest_payout_wallet',
    });
  });

  it('a null payout is unobservable: unknown with the in-writing detail, and the proof stays observed', () => {
    const { finding, built, values } = record(
      run('a', result(), reading('null'), reading('null'))
    );
    expect(finding?.answer).toBe('unknown');
    expect(finding?.detail).toMatch(/in writing/);
    expect(built.status).toBe('observed');
    expect(values.goal_a_verdict).toBe('not_proven');
  });

  it.each([
    ['self', 'yes', 'proven'],
    ['main', 'no', 'not_proven'],
    ['business', 'no', 'not_proven'],
    ['other', 'no', 'not_proven'],
  ] as const)('payout %s answers %s (%s)', (payout, answer, verdict) => {
    const { finding, values } = record(
      run('c', result(), reading(payout), reading(payout))
    );
    expect(finding?.answer).toBe(answer);
    expect(finding?.detail).toBeUndefined();
    expect(values.goal_c_verdict).toBe(verdict);
  });

  it('the 5-minute reading decides; the first stands when the recheck is unread or omits the payout', () => {
    const later = record(run('a', result(), reading('null'), reading('self')));
    expect(later.finding?.answer).toBe('yes');
    expect(later.values.goal_a_verdict).toBe('proven');
    const first = record(run('a', result(), reading('self'), UNREAD));
    expect(first.finding?.answer).toBe('yes');
    const flipped = record(
      run('a', result(), reading('self'), reading('main'))
    );
    expect(flipped.finding?.answer).toBe('no');
    // A recheck that omits the payout field keeps the settled first reading.
    const omitted = record(
      run('a', result(), reading('self'), reading('absent'))
    );
    expect(omitted.finding?.answer).toBe('yes');
    expect(omitted.values.goal_a_payout_at_5m).toBe('absent');
  });
});

describe('recordStaysInGoal: an opted-out goal proves nothing about where interest goes', () => {
  it.each([
    ['reads accrual off', false],
    ['shows no accrual flag', null],
  ] as const)('goal (b), which was created opted out and %s, never proves it even when the readback names the goal', (_label, flagShown) => {
    const { finding, values, built } = record(
      run('b', result(), reading('self', flagShown), reading('self', flagShown))
    );
    expect(finding?.answer).toBe('unknown');
    expect(finding?.detail).toBe(NO_ACCRUAL_DETAIL);
    expect(values.goal_b_verdict).toBe('not_proven');
    // Nothing failed: the question simply does not apply, so the proof is not inconclusive.
    expect(built.status).toBe('observed');
  });

  it('an opted-in goal that reads accrual off is not proven either; one that reads it on still is', () => {
    const off = record(
      run('a', result(), reading('self', true), reading('self', false))
    );
    expect(off.finding?.answer).toBe('unknown');
    expect(off.values.goal_a_verdict).toBe('not_proven');
    const on = record(
      run('a', result(), reading('self', false), reading('self', true))
    );
    expect(on.finding?.answer).toBe('yes');
    expect(on.values.goal_a_verdict).toBe('proven');
  });

  it('a payout that names another wallet stays a no for goal (b): accrual does not turn it into proof', () => {
    const { finding, values } = record(
      run('b', result(), reading('main', false), reading('main', false))
    );
    expect(finding?.answer).toBe('no');
    expect(values.goal_b_verdict).toBe('not_proven');
  });
});

describe('routingNotes: the verdict table and what the owner does next', () => {
  const others = [
    run('b', result(), reading('null', false), reading('null', false)),
    run('c', result(), reading('main'), reading('main')),
  ];

  it('always carries the legend and the sandbox-rate note', () => {
    for (const runs of [[], others]) {
      const notes = routingNotes(runs);
      expect(notes).toContain(PSEUDONYM_LEGEND);
      expect(notes).toContain(SANDBOX_RATE_NOTE);
    }
  });

  it.each([
    ['null', [run('a', result(), reading('null'), reading('null'))]],
    ['unread', [run('a', result())]],
    ['missing', []],
  ] as const)('asks the owner question when goal (a) reads %s', (_label, a) => {
    expect(routingNotes([...a, ...others])).toContain(OWNER_QUESTION_NOTE);
  });

  it('drops the owner question only when goal (a) names itself while interest accrues', () => {
    const a = run('a', result(), reading('null'), reading('self'));
    const notes = routingNotes([a, ...others]);
    expect(notes).not.toContain(OWNER_QUESTION_NOTE);
    expect(notes).not.toContain(OWNER_QUESTION_NAMED_NOTE);
    // Naming itself with accrual off proves nothing, so the question stays.
    const off = run(
      'a',
      result(),
      reading('self', false),
      reading('self', false)
    );
    expect(routingNotes([off, ...others])).toContain(OWNER_QUESTION_NOTE);
  });

  it.each([
    'business',
    'main',
    'other',
  ] as const)('asks only whether the goal can pay itself when goal (a) already names %s', (payout) => {
    const a = run('a', result(), reading(payout), reading(payout));
    const notes = routingNotes([a, ...others]);
    expect(notes).toContain(OWNER_QUESTION_NAMED_NOTE);
    expect(notes).not.toContain(OWNER_QUESTION_NOTE);
    expect(OWNER_QUESTION_NAMED_NOTE).not.toMatch(/where is its interest paid/);
  });

  it('one table line per run, with "unread" for an unread accrual flag', () => {
    const notes = routingNotes([run('a', result()), ...others]);
    expect(notes.filter((note) => note.startsWith('Goal ('))).toHaveLength(3);
    expect(notes[0]).toBe(
      'Goal (a) opted in, payout unset: accepted; payout at 0 min unread, at 5 min unread; interest_enabled unread then unread; verdict not proven.'
    );
    expect(notes[1]).toContain('interest_enabled false then false');
  });
});
