import {
  explicitDestinationAnswer,
  finalReading,
  inheritsBusinessPayoutAnswer,
  POST_CREATION_PAYOUT_DOCS_CHECKED,
  POST_CREATION_PAYOUT_UPDATE_DOCUMENTED,
} from './goal-interest-routing';
import { type GoalRoutingRun, runGoalRouting } from './proof-7-goal-routing';
import {
  NULL_DETAIL,
  recordRoutingValues,
  recordStaysInGoal,
  routingNotes,
} from './proof-7-goal-routing-records';
import type { GoalOwner } from './proof-7-goal-variants';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { Answer } from './types';

/**
 * Proof 7, part 3: goal sub-wallet interest routing. Four variants under one
 * owner (opted in or out with the payout unset, and opted in with the payout
 * set to the owner's main wallet or to the business wallet), each read back at
 * once and after five minutes. Answers come from the readbacks, which are
 * polled and never turn an unread wallet into a "no"; only a readback naming
 * the goal itself proves interest stays in the goal.
 */

const DOCS_FINDING = 'goal_payout_update_after_creation_documented';

const MEASURED = [
  [
    'goal_without_payout_created',
    'Is a goal sub-wallet with its own payout left unset created?',
  ],
  [
    'goal_without_payout_inherits_business_payout',
    "Does a goal wallet with no payout of its own inherit the customer's business payout wallet?",
  ],
  [
    'goal_explicit_payout_accepted',
    'Does POST /wallet/sub-account accept interest_payout_wallet?',
  ],
  [
    'goal_explicit_readback_names_payout_destination',
    'Does the explicit goal wallet readback name that payout wallet?',
  ],
  [
    'goal_opted_out_created',
    'Is an opted-out goal sub-wallet (accrual off, payout unset) created?',
  ],
  [
    'goal_opted_out_reads_accrual_off',
    'Does the opted-out goal read back interest_enabled=false?',
  ],
  [
    'goal_payout_main_accepted',
    "Does POST /wallet/sub-account accept interest_payout_wallet set to the customer's own main wallet?",
  ],
  ...(['a', 'b', 'c', 'd'] as const).map(
    (id) =>
      [
        `goal_${id}_interest_stays_in_goal`,
        `Goal (${id}): does its readback name the goal itself as the payout wallet (interest stays in the goal)?`,
      ] as const
  ),
] as const;
const question = (id: string): string =>
  MEASURED.find(([key]) => key === id)?.[1] ?? id;

function recordDocsCheck(b: ProofBuilder): void {
  b.finding(
    DOCS_FINDING,
    "Does a documented endpoint set a goal's interest payout (to itself) after creation?",
    POST_CREATION_PAYOUT_UPDATE_DOCUMENTED ? 'yes' : 'no',
    `PiggyVest public API docs read ${POST_CREATION_PAYOUT_DOCS_CHECKED}: no endpoint changes a wallet's interest payout or accrual after creation; nothing undocumented was tried`
  );
}

function accrualOffAnswer(run: GoalRoutingRun | undefined): Answer {
  if (!run) return 'unknown';
  const flag = finalReading(run.atOnce, run.afterRecheck).interestEnabled;
  return flag === null ? 'unknown' : flag === false ? 'yes' : 'no';
}

/** Goal (a)'s inheritance, judged by the same final reading as its verdict. */
function inheritance(
  run: GoalRoutingRun | undefined,
  mainDestinationPaths: readonly string[]
): [Answer | 'unobservable', string?] {
  const payout = run?.result
    ? finalReading(run.atOnce, run.afterRecheck).payout
    : 'unread';
  const answer = inheritsBusinessPayoutAnswer(payout, mainDestinationPaths);
  if (answer === 'unobservable') return [answer, NULL_DETAIL];
  if (answer !== 'unknown') return [answer];
  return [
    answer,
    payout === 'unread'
      ? 'the goal could not be read back'
      : 'the readback omits a payout destination to compare, so inheritance cannot be determined',
  ];
}

export async function recordGoalWallets(
  ctx: ProofContext,
  b: ProofBuilder,
  owner: GoalOwner | null,
  business: string,
  mainDestinationPaths: readonly string[]
): Promise<void> {
  recordDocsCheck(b);
  if (!owner) {
    for (const [id] of MEASURED)
      b.finding(id, question(id), 'unknown', 'no QA customer available');
    return;
  }
  const runs = await runGoalRouting(ctx, owner, business);
  const run = (id: string) => runs.find((r) => r.variant.id === id);
  const unset = run('a')?.result ?? null;
  const optedOut = run('b')?.result ?? null;
  const main = run('c')?.result ?? null;
  const explicit = run('d')?.result ?? null;
  const unsetInherits = inheritance(run('a'), mainDestinationPaths);
  // Judged by the same final reading as goal (d)'s verdict and values.
  const explicitRun = run('d');
  const explicitPayout = explicitRun
    ? finalReading(explicitRun.atOnce, explicitRun.afterRecheck).payout
    : 'unread';
  const answers: Record<string, [Answer | 'unobservable', string?]> = {
    goal_without_payout_created: [answerOf(unset?.exists ?? null)],
    goal_without_payout_inherits_business_payout: unsetInherits,
    goal_explicit_payout_accepted: [answerOf(explicit?.accepted ?? null)],
    goal_explicit_readback_names_payout_destination: [
      explicitDestinationAnswer(explicitPayout),
    ],
    goal_opted_out_created: [answerOf(optedOut?.exists ?? null)],
    goal_opted_out_reads_accrual_off: [accrualOffAnswer(run('b'))],
    goal_payout_main_accepted: main
      ? [answerOf(main.accepted)]
      : ['unknown', "the owner's main wallet is unknown, so it was not sent"],
  };
  for (const [id, [answer, detail]] of Object.entries(answers)) {
    if (answer === 'unobservable')
      b.unobservable(id, question(id), detail ?? NULL_DETAIL);
    else b.finding(id, question(id), answer, detail);
  }
  for (const routed of runs) {
    recordStaysInGoal(
      b,
      routed,
      question(`goal_${routed.variant.id}_interest_stays_in_goal`)
    );
    recordRoutingValues(ctx, b, routed);
  }
  for (const routed of runs) {
    if (routed.result?.resumedOutcome) {
      b.inconclusive('a sub-wallet slot was already executed');
      b.note(
        `A sub-wallet slot was already used (${routed.result.resumedOutcome}); it is never resent. Use --new-attempt to repeat it.`
      );
    }
  }
  if (unsetInherits[0] === 'yes') {
    b.note(
      'A goal wallet with no payout of its own INHERITS the customer payout wallet: goal interest would reach Ogabassey. Goal wallets must set their payout explicitly.'
    );
  }
  for (const note of routingNotes(runs)) b.note(note);
}
