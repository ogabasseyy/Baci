import { AMOUNTS_KOBO } from './constants';
import { readTransferFeeKobo } from './debit-once';
import { pickString } from './loose-schemas';
import { settledAfterMovement } from './movement';
import { EARLIER_UNSETTLED, MovementLedger } from './movement-ledger';
import { delta, readingOf, settledWallets, statusOf } from './poll';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, usableList } from './read-rules';
import {
  disposition,
  type FollowUpVerdict,
  followUpAfterSubmit,
} from './tsq-follow-up';
import type { Answer } from './types';
import { transferVerdict } from './verdict-rule';

/**
 * S8, step 6: a timeout on submit. The request leaves and the provider may
 * book it, but the response is lost (TransportFaults), so the outcome is
 * indeterminate. The only follow-up is a status check (TSQ) on the SAME
 * reference, repeated within the polling budget. A 404 straight after submit
 * is uncertain ("not indexed yet" looks identical to "never arrived"), so it
 * is never a reason to resend. Nothing in this step can send a second POST.
 */

export const TIMEOUT_INDETERMINATE = 's8_timeout_submit_is_indeterminate';
export const TIMEOUT_TSQ_FIRST = 's8_timeout_tsq_before_any_resend';
export const NOT_FOUND_UNCERTAIN = 's8_timeout_not_found_is_uncertain';
export const TIMEOUT_BOOKED_ONCE = 's8_timeout_transfer_booked_once';

const Q = {
  [TIMEOUT_INDETERMINATE]:
    'Is a submit whose response was lost recorded as indeterminate, not as a failure?',
  [TIMEOUT_TSQ_FIRST]:
    'Is the status of the reference checked after the lost response, with no resend?',
  [NOT_FOUND_UNCERTAIN]:
    'Is a 404 right after submit treated as uncertain, with checking continued and no resend?',
  [TIMEOUT_BOOKED_ONCE]:
    'Did the provider book the timed-out transfer exactly once?',
} as const;

function countRows(call: CallResult, reference: string): number {
  const list = usableList(call);
  return list
    ? list.edges.filter(
        (edge) => pickString(edge, ['third_party_reference']) === reference
      ).length
    : 0;
}

function allUnknown(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  for (const [id, question] of Object.entries(Q))
    b.finding(id, question, 'unknown', reason);
}

export async function stepTimeoutRetry(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  goal: string,
  /** Every earlier movement; an unsettled one makes its wallets not quiet. */
  ledger: MovementLedger = new MovementLedger()
): Promise<void> {
  const { api, qa, faults, redactor } = ctx;
  if (!faults)
    return allUnknown(b, 'no transport fault injector is configured');
  const amount = AMOUNTS_KOBO.s8TimeoutTransfer;
  const earlierSettled = ledger.isQuiet(main, goal);
  const baseline = await settledWallets(ctx, [main, goal]);

  faults.loseNextResponse('/api/v1/transfer/wallet');
  let sent: Awaited<ReturnType<typeof api.transferWallet>>;
  try {
    sent = await api.transferWallet(
      qa,
      main,
      goal,
      amount,
      'p10/timeout_submit'
    );
  } finally {
    faults.clear(); // a resumed slot sends nothing and must not leave the fault armed
  }
  redactor.register('R', sent.reference);
  if (sent.kind === 'resumed') {
    b.note(
      `The S8 timeout slot was already used (${sent.priorOutcome}); it is never resent. Its journaled reference is checked read-only.`
    );
  } else {
    b.value('timeout_submit_http_status', sent.call.httpStatus).value(
      'timeout_submit_outcome',
      sent.outcome
    );
  }
  // A resumed slot sent nothing this run: only a journaled indeterminate
  // outcome proves the lost response; any other prior state is unmeasured.
  const indeterminateAnswer: Answer =
    sent.kind === 'sent'
      ? answerOf(
          sent.outcome === 'indeterminate' && sent.call.httpStatus === null
        )
      : sent.priorOutcome === 'indeterminate'
        ? 'yes'
        : 'unknown';
  b.finding(
    TIMEOUT_INDETERMINATE,
    Q[TIMEOUT_INDETERMINATE],
    indeterminateAnswer,
    indeterminateAnswer === 'unknown'
      ? 'the slot was resumed and its journaled outcome does not show a lost response'
      : undefined
  );
  if (indeterminateAnswer === 'unknown') {
    b.inconclusive('S8 timeout submit was not observed in this run');
  }

  // Status checks on the SAME reference. No branch here can send a POST.
  const verdicts: FollowUpVerdict[] = [];
  let notFound = 0;
  let firstNotFoundAt: number | null = null;
  for (let poll = 0; poll <= ctx.maxPolls; poll += 1) {
    const follow = followUpAfterSubmit(
      statusOf(await api.verify(sent.reference, main))
    );
    verdicts.push(follow.verdict);
    if (follow.notFound) {
      notFound += 1;
      firstNotFoundAt ??= verdicts.length - 1;
    }
    if (follow.verdict === 'settled' || follow.verdict === 'failed') break;
    await ctx.sleep(ctx.pollIntervalMs);
  }
  const outcome = disposition(verdicts);
  b.value('timeout_status_checks', verdicts.length)
    .value('timeout_not_found_checks', notFound)
    .value('timeout_resend_attempts', 0)
    .value('timeout_disposition', outcome);
  b.finding(
    TIMEOUT_TSQ_FIRST,
    Q[TIMEOUT_TSQ_FIRST],
    answerOf(verdicts.length >= 1)
  );
  // "Checking continued" needs at least one status check AFTER the first 404;
  // a 404 on the very last check shows nothing about what came next.
  const continued =
    firstNotFoundAt !== null && firstNotFoundAt < verdicts.length - 1;
  const notFoundAnswer: Answer =
    notFound === 0 ? 'not_applicable' : continued ? 'yes' : 'unknown';
  const notFoundReason =
    notFound === 0
      ? 'no 404 was seen; a live sandbox cannot force one, the mock covers it'
      : continued
        ? undefined
        : 'the 404 was the last status check, so continued checking was not observed';
  b.finding(
    NOT_FOUND_UNCERTAIN,
    Q[NOT_FOUND_UNCERTAIN],
    notFoundAnswer,
    notFoundReason
  );

  if (outcome !== 'settled') {
    b.note(
      outcome === 'hold_for_reconcile'
        ? 'The status stayed uncertain for the whole budget: the transfer is held for reconciliation, never retried.'
        : 'The provider reports a definite failure: the reference is released and any retry would need a NEW reference.'
    );
    b.inconclusive(`the timed-out transfer ended as ${outcome}`);
    b.finding(TIMEOUT_BOOKED_ONCE, Q[TIMEOUT_BOOKED_ONCE], 'unknown');
    return;
  }
  // A resumed slot was booked before this run's baseline: nothing to measure.
  // Otherwise the main balance must SHOW the booking; an unchanged, lagging
  // balance is not a result.
  const after =
    sent.kind === 'resumed'
      ? null
      : await settledAfterMovement(ctx, [main, goal], baseline, [main, goal]);
  const measured = after !== null && baseline.settled && after.settled;
  const moved = measured && after.moved;
  const mainDelta =
    after && moved
      ? delta(readingOf(baseline, main).balance, readingOf(after, main).balance)
      : null;
  const goalDelta =
    after && moved
      ? delta(readingOf(baseline, goal).balance, readingOf(after, goal).balance)
      : null;
  const listed = await pollSettled(
    ctx,
    () => api.transactions({ wallet_id: main, limit: '50' }),
    (call) => countRows(call, sent.reference) >= 1
  );
  // The list can lag the status check and the balances: an empty but readable
  // list is not a measurement. Only a row actually found is counted.
  const rows = listed.settled ? countRows(listed.value, sent.reference) : null;
  b.value('timeout_main_delta_kobo', mainDelta)
    .value('timeout_goal_delta_kobo', goalDelta)
    .value('timeout_rows_with_reference', rows);
  // A resumed slot was booked BEFORE this run's baseline was read, so the
  // main delta is 0 by construction: it cannot show how often it was booked.
  const debit = mainDelta === null ? null : -mainDelta;
  const resumed = sent.kind === 'resumed';
  const unmeasured =
    resumed ||
    !earlierSettled ||
    debit === null ||
    goalDelta === null ||
    rows === null;
  const fee = unmeasured
    ? null
    : await readTransferFeeKobo(ctx, sent.reference, main);
  b.value('timeout_fee_from_record_kobo', fee);
  // The same rule as the funding step: the debit and the goal credit must
  // both match ONE transfer (a recorded fee counts once across both). The
  // single matching record decides whether it was booked once.
  const verdict =
    unmeasured || debit === null || goalDelta === null
      ? null
      : transferVerdict(amount, debit, goalDelta, fee);
  // Rows that disagree with the balances are never 'no' on their own: only a
  // balance verdict of 'no' (a real second booking) publishes 'no'.
  const rowsDisagree = !unmeasured && rows !== 1;
  const answer: Answer = unmeasured
    ? 'unknown'
    : rows === 1
      ? (verdict?.answer ?? 'unknown')
      : verdict?.answer === 'no'
        ? 'no'
        : 'unknown';
  b.finding(
    TIMEOUT_BOOKED_ONCE,
    Q[TIMEOUT_BOOKED_ONCE],
    answer,
    !earlierSettled
      ? EARLIER_UNSETTLED
      : resumed
        ? 'the slot was booked in an earlier run, so this run has no pre-booking balance to compare'
        : debit === null || goalDelta === null
          ? 'the main and goal balances never showed the booking within the polling budget'
          : rows === null
            ? 'the transaction list never showed the reference within the polling budget'
            : answer === 'unknown'
              ? rowsDisagree
                ? `the transaction list shows ${rows} rows for the reference but the balances show one transfer; human review`
                : verdict?.detail
              : undefined
  );
}
