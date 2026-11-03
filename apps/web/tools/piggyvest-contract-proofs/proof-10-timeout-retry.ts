import { AMOUNTS_KOBO } from './constants';
import { pickString } from './loose-schemas';
import { delta, readingOf, settledWallets, statusOf } from './poll';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { pollSettled, usableList } from './read-rules';
import {
  disposition,
  type FollowUpVerdict,
  followUpAfterSubmit,
} from './tsq-follow-up';

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

function allUnknown(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  for (const [id, question] of Object.entries(Q))
    b.finding(id, question, 'unknown', reason);
}

export async function stepTimeoutRetry(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  goal: string
): Promise<void> {
  const { api, qa, faults, redactor } = ctx;
  if (!faults)
    return allUnknown(b, 'no transport fault injector is configured');
  const amount = AMOUNTS_KOBO.s8TimeoutTransfer;
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
  const indeterminate =
    sent.kind === 'sent'
      ? sent.outcome === 'indeterminate' && sent.call.httpStatus === null
      : sent.priorOutcome === 'indeterminate';
  b.finding(
    TIMEOUT_INDETERMINATE,
    Q[TIMEOUT_INDETERMINATE],
    answerOf(indeterminate)
  );

  // Status checks on the SAME reference. No branch here can send a POST.
  const verdicts: FollowUpVerdict[] = [];
  let notFound = 0;
  for (let poll = 0; poll <= ctx.maxPolls; poll += 1) {
    const follow = followUpAfterSubmit(
      statusOf(await api.verify(sent.reference, main))
    );
    verdicts.push(follow.verdict);
    if (follow.notFound) notFound += 1;
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
  b.finding(
    NOT_FOUND_UNCERTAIN,
    Q[NOT_FOUND_UNCERTAIN],
    notFound === 0 ? 'not_applicable' : 'yes',
    notFound === 0
      ? 'no 404 was seen; a live sandbox cannot force one, the mock covers it'
      : undefined
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
  const after = await settledWallets(ctx, [main, goal]);
  const mainDelta =
    baseline.settled && after.settled
      ? delta(readingOf(baseline, main).balance, readingOf(after, main).balance)
      : null;
  const listed = await pollSettled(
    ctx,
    () => api.transactions({ wallet_id: main, limit: '50' }),
    (call) => usableList(call) !== null
  );
  const list = usableList(listed.value);
  const rows = list
    ? list.edges.filter(
        (edge) => pickString(edge, ['third_party_reference']) === sent.reference
      ).length
    : null;
  b.value('timeout_main_delta_kobo', mainDelta).value(
    'timeout_rows_with_reference',
    rows
  );
  // A resumed slot was booked BEFORE this run's baseline was read, so the
  // main delta is 0 by construction: it cannot show how often it was booked.
  const debit = mainDelta === null ? null : -mainDelta;
  const resumed = sent.kind === 'resumed';
  const unmeasured = resumed || debit === null || rows === null;
  b.finding(
    TIMEOUT_BOOKED_ONCE,
    Q[TIMEOUT_BOOKED_ONCE],
    unmeasured
      ? 'unknown'
      : // Same band as the fund step: a fee may ride on the debit, a second
        // booking would take 2x; the single matching record decides the rest.
        answerOf(rows === 1 && debit >= amount && debit < amount * 2),
    resumed
      ? 'the slot was booked in an earlier run, so this run has no pre-booking balance to compare'
      : undefined
  );
}
