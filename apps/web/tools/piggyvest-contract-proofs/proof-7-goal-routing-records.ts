import {
  accrualOn,
  finalReading,
  type GoalRoutingReading,
  goalRoutingVerdict,
  staysInGoalAnswer,
} from './goal-interest-routing';
import type { GoalRoutingRun } from './proof-7-goal-routing';
import type { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';

/**
 * How proof 7 writes the goal-routing runs into evidence: per-variant values
 * (status, outcome, the two readings as pseudonyms, the verdict), the
 * stays-in-goal finding, and the verdict-table notes. Nothing here carries an
 * id or a name: payouts are pseudonyms and provider messages are redacted.
 */

export const NULL_DETAIL =
  'the readback names no payout wallet (null): that proves nothing unless PiggyVest confirms in writing where it pays; sandbox rates are 0%, so no payout can be observed';

export const PSEUDONYM_LEGEND =
  "Goal payout pseudonyms: self = the goal itself; main = the customer's main wallet; business = the business (interest) wallet; null = the payout field is empty; other = any other wallet; absent = the readback omitted the field; unread = no readback. Only self proves interest stays in the goal; null proves nothing unless PiggyVest confirms it in writing.";

export const SANDBOX_RATE_NOTE =
  'Sandbox interest rates are 0%, so no interest payout can be observed here: where goal interest is really paid stays a release check (the first monthly payout).';

export const NO_ACCRUAL_DETAIL =
  'accrual is off for this goal, so no interest accrues to route: a readback naming the goal itself proves nothing about where interest is paid';

export const OWNER_QUESTION_NAMED_NOTE =
  'Written question for the owner to send PiggyVest: a goal sub-wallet created with enable_interest_accrual=true and no interest_payout_wallet reads back paying another wallet, not the goal itself. Can a goal sub-wallet pay its interest into the goal itself, given its id is not known before it is created and no documented endpoint changes the payout afterwards? Until PiggyVest answers in writing, goal interest staying in the goal counts as not proven.';

export const OWNER_QUESTION_NOTE =
  'Written question for the owner to send PiggyVest: when a goal sub-wallet is created with enable_interest_accrual=true and no interest_payout_wallet, where is its interest paid, and can it be paid into the goal itself? Until PiggyVest answers in writing, goal interest staying in the goal counts as not proven.';

/** The run's final reading and whether interest accrues in that goal. */
function judged(run: GoalRoutingRun) {
  const final = finalReading(run.atOnce, run.afterRecheck);
  return { final, accruing: accrualOn(final, run.variant.accrual) };
}

function outcomeOf(run: GoalRoutingRun): string {
  const result = run.result;
  if (!result) return 'not_sent';
  if (result.resumedOutcome) return 'resumed';
  if (result.accepted === true) return 'accepted';
  return result.accepted === false ? 'rejected' : 'unknown';
}

export function recordStaysInGoal(
  b: ProofBuilder,
  run: GoalRoutingRun,
  question: string
): void {
  const id = `goal_${run.variant.id}_interest_stays_in_goal`;
  if (!run.result) {
    b.finding(
      id,
      question,
      'unknown',
      "the owner's main wallet is unknown, so it was not sent"
    );
    return;
  }
  const {
    final: { payout },
    accruing,
  } = judged(run);
  if (payout === 'null') {
    b.unobservable(id, question, NULL_DETAIL);
    return;
  }
  if (payout === 'self' && !accruing) {
    b.unobservable(id, question, NO_ACCRUAL_DETAIL);
    return;
  }
  const answer = staysInGoalAnswer(payout, accruing);
  b.finding(
    id,
    question,
    answer,
    answer !== 'unknown'
      ? undefined
      : payout === 'absent'
        ? 'the goal readback did not show interest_payout_wallet'
        : 'the goal could not be read back'
  );
}

export function recordRoutingValues(
  ctx: ProofContext,
  b: ProofBuilder,
  run: GoalRoutingRun
): void {
  const prefix = `goal_${run.variant.id}_`;
  const result = run.result;
  b.value(`${prefix}http_status`, result?.httpStatus ?? null);
  b.value(`${prefix}outcome`, outcomeOf(run));
  if (result?.errorMessage) {
    b.value(
      `${prefix}error_message`,
      ctx.redactor.message(result.errorMessage)
    );
  }
  b.value(`${prefix}interest_enabled_at_0m`, run.atOnce.interestEnabled);
  b.value(`${prefix}payout_at_0m`, run.atOnce.payout);
  b.value(`${prefix}interest_enabled_at_5m`, run.afterRecheck.interestEnabled);
  b.value(`${prefix}payout_at_5m`, run.afterRecheck.payout);
  const { final, accruing } = judged(run);
  b.value(`${prefix}verdict`, goalRoutingVerdict(final.payout, accruing));
}

const flag = (reading: GoalRoutingReading): string =>
  reading.interestEnabled === null ? 'unread' : String(reading.interestEnabled);

/** The verdict table (one line per variant) and what the owner does next. */
export function routingNotes(runs: readonly GoalRoutingRun[]): string[] {
  const table = runs.map((run) => {
    const { final, accruing } = judged(run);
    const verdict = goalRoutingVerdict(final.payout, accruing);
    return `Goal (${run.variant.id}) ${run.variant.label}: ${outcomeOf(run)}; payout at 0 min ${run.atOnce.payout}, at 5 min ${run.afterRecheck.payout}; interest_enabled ${flag(run.atOnce)} then ${flag(run.afterRecheck)}; verdict ${verdict === 'proven' ? 'proven' : 'not proven'}.`;
  });
  return [
    ...table,
    PSEUDONYM_LEGEND,
    SANDBOX_RATE_NOTE,
    ...ownerQuestion(runs),
  ];
}

/**
 * The written question for PiggyVest, from goal (a)'s final reading: none
 * once it names itself while interest accrues; a narrower one when it already
 * names another wallet (where interest goes is answered, whether it can go to
 * the goal is not); the full one otherwise.
 */
function ownerQuestion(runs: readonly GoalRoutingRun[]): string[] {
  const unset = runs.find((run) => run.variant.id === 'a');
  if (!unset) return [OWNER_QUESTION_NOTE];
  const { final, accruing } = judged(unset);
  if (final.payout === 'self' && accruing) return [];
  const named = ['main', 'business', 'other'].includes(final.payout);
  return [named ? OWNER_QUESTION_NAMED_NOTE : OWNER_QUESTION_NOTE];
}
