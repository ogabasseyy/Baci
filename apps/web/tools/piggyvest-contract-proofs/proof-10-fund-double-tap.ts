import { AMOUNTS_KOBO } from './constants';
import { readTransferFeeKobo } from './debit-once';
import { pickString } from './loose-schemas';
import { settledAfterMovement } from './movement';
import {
  awaitTerminal,
  delta,
  readingOf,
  settledWallets,
  statusOf,
} from './poll';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, usableList } from './read-rules';
import type { Answer } from './types';
import { transferVerdict } from './verdict-rule';

/**
 * S8, steps 4 and 5: fund the goal wallet from the main wallet, then tap the
 * same action a second time. A double tap must yield exactly ONE provider
 * transfer, so both layers are measured: the app path (the same slot sends
 * nothing the second time) and the wire (the SAME reference sent again must
 * not debit twice or add a second record). Whatever the provider does with a
 * repeated reference is recorded, but production never relies on it.
 */

export const FUND_GOAL = 's8_fund_goal_moves_money_once';
export const TAP_SENDS_ONCE = 's8_double_tap_app_sends_once';
export const TAP_ONCE = 's8_double_tap_exactly_one_transfer';

const FUND_Q =
  'Does funding the goal from main debit main once and credit the goal once?';
const TAP_SENDS_Q =
  'Does a second tap with the same idempotency key send nothing new from the app?';
const TAP_ONCE_Q =
  'After a double tap on the wire, is there exactly one provider transfer and one debit?';

export interface FundGoalResult {
  reference: string;
  amountKobo: number;
  sendAccepted: boolean;
  /** True only when the original funding reached a terminal success. */
  terminalSuccess: boolean;
  /** Settled main balance after the funding; null if it never settled. */
  mainBalanceKobo: number | null;
  mainDeltaKobo: number | null;
  goalDeltaKobo: number | null;
}

export async function stepFundGoal(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  goal: string
): Promise<FundGoalResult | null> {
  const { api, qa, redactor } = ctx;
  const amount = AMOUNTS_KOBO.s8FundGoal;
  const baseline = await settledWallets(ctx, [main, goal]);
  const sent = await api.transferWallet(
    qa,
    main,
    goal,
    amount,
    'p10/fund_goal'
  );
  redactor.register('R', sent.reference);
  if (sent.kind === 'resumed') {
    b.note(
      `The S8 fund-goal slot was already used (${sent.priorOutcome}); it is never resent. Repeating it needs a full run without the --proof p10 filter, using --new-attempt.`
    );
    b.inconclusive('S8 goal funding already executed in an earlier run');
    b.finding(FUND_GOAL, FUND_Q, 'unknown');
    return null;
  }
  b.value('fund_goal_http_status', sent.call.httpStatus).value(
    'fund_goal_outcome',
    sent.outcome
  );
  const result: FundGoalResult = {
    reference: sent.reference,
    amountKobo: amount,
    sendAccepted: sent.outcome === 'accepted',
    terminalSuccess: false,
    mainBalanceKobo: null,
    mainDeltaKobo: null,
    goalDeltaKobo: null,
  };
  if (!sent.call.ok) {
    b.inconclusive('the goal funding transfer was not accepted');
    b.finding(FUND_GOAL, FUND_Q, 'unknown', 'the transfer was not accepted');
    return result;
  }
  const watch = await awaitTerminal(
    ctx,
    sent.reference,
    main,
    await api.verify(sent.reference, main)
  );
  // Both balances must SHOW the transfer: a lagging, unchanged balance is not
  // a settled result.
  const after = await settledAfterMovement(ctx, [main, goal], baseline, [
    main,
    goal,
  ]);
  const measured = baseline.settled && after.settled && after.moved;
  result.mainBalanceKobo = after.settled
    ? readingOf(after, main).balance
    : null;
  result.mainDeltaKobo = measured
    ? delta(readingOf(baseline, main).balance, readingOf(after, main).balance)
    : null;
  result.goalDeltaKobo = measured
    ? delta(readingOf(baseline, goal).balance, readingOf(after, goal).balance)
    : null;
  result.terminalSuccess = watch.terminal === 'success';
  b.value('fund_goal_terminal', watch.terminal)
    .value('fund_goal_main_delta_kobo', result.mainDeltaKobo)
    .value('fund_goal_goal_delta_kobo', result.goalDeltaKobo);
  const { mainDeltaKobo: main$, goalDeltaKobo: goal$ } = result;
  if (watch.terminal !== 'success' || main$ === null || goal$ === null) {
    b.inconclusive('the goal funding did not reach a settled, measured result');
    b.finding(
      FUND_GOAL,
      FUND_Q,
      'unknown',
      watch.terminal !== 'success'
        ? 'the funding did not reach a terminal success'
        : 'the balances never showed the transfer within the polling budget'
    );
    return result;
  }
  // One transfer takes the amount plus, at most, the fee the record shows,
  // on either side. A difference the record cannot explain is never "once".
  const fee = await readTransferFeeKobo(ctx, sent.reference, main);
  b.value('fund_goal_fee_from_record_kobo', fee);
  const verdict = transferVerdict(amount, -main$, goal$, fee);
  b.finding(FUND_GOAL, FUND_Q, verdict.answer, verdict.detail);
  return result;
}

function unknownTap(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  b.finding(TAP_SENDS_ONCE, TAP_SENDS_Q, 'unknown', reason);
  b.finding(TAP_ONCE, TAP_ONCE_Q, 'unknown', reason);
}

export async function stepDoubleTap(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  goal: string,
  fund: FundGoalResult | null
): Promise<void> {
  const { api, qa } = ctx;
  if (
    !fund?.sendAccepted ||
    !fund.terminalSuccess ||
    fund.mainBalanceKobo === null
  ) {
    // The wire repeat is only meaningful against a settled original: a still
    // pending one would settle later and look like a second debit.
    return unknownTap(
      b,
      'no settled, accepted goal funding to tap a second time'
    );
  }
  const reference = fund.reference;

  // Tap 2, app path: the same slot (the idempotency key) must send nothing.
  const second = await api.transferWallet(
    qa,
    main,
    goal,
    fund.amountKobo,
    'p10/fund_goal'
  );
  const appSentNothing =
    second.kind === 'resumed' && second.reference === reference;
  b.value('double_tap_app_second_send', appSentNothing ? 'not_sent' : 'sent');
  b.finding(TAP_SENDS_ONCE, TAP_SENDS_Q, answerOf(appSentNothing));

  // Tap 2, wire: the SAME reference sent again.
  const countRows = (call: CallResult): number | null => {
    const list = usableList(call);
    return list
      ? list.edges.filter(
          (edge) => pickString(edge, ['third_party_reference']) === reference
        ).length
      : null;
  };
  const listMain = () => api.transactions({ wallet_id: main, limit: '50' });
  const original = await pollSettled(
    ctx,
    listMain,
    (list) => (countRows(list) ?? 0) >= 1
  );
  const rowsBefore = original.settled ? countRows(original.value) : null;
  const again = await api.transferWalletAgain(
    qa,
    main,
    goal,
    fund.amountKobo,
    reference,
    'p10/double_tap_wire',
    'p10/fund_goal'
  );
  if (again.kind === 'resumed') {
    b.note(
      `The S8 wire-repeat slot was already used (${again.priorOutcome}); it is never resent.`
    );
    b.inconclusive('S8 wire-level repeat already executed in an earlier run');
    b.finding(TAP_ONCE, TAP_ONCE_Q, 'unknown');
    return;
  }
  b.value('double_tap_wire_http_status', again.call.httpStatus).value(
    'double_tap_wire_outcome',
    again.outcome
  );
  b.value(
    'double_tap_status_after',
    statusOf(await api.verify(reference, main))
  );
  if (again.outcome !== 'rejected') {
    // The original's terminal status says nothing about the repeat: keep
    // observing for the whole polling budget, never stopping on that status.
    for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
      await ctx.sleep(ctx.pollIntervalMs);
      await api.verify(reference, main);
    }
  }
  const settled = await settledWallets(ctx, [main]);
  const extraDebit = settled.settled
    ? delta(readingOf(settled, main).balance, fund.mainBalanceKobo)
    : null;
  const listed = await pollSettled(
    { ...ctx, maxPolls: again.outcome === 'rejected' ? 0 : ctx.maxPolls },
    listMain,
    (list) => (countRows(list) ?? 0) > (rowsBefore ?? 0)
  );
  const rowsAfter = countRows(listed.value);
  b.value('double_tap_rows_with_reference', rowsAfter).value(
    'double_tap_extra_debit_kobo',
    extraDebit
  );
  b.note(
    'Double tap: the provider behaviour on a repeated reference is recorded only; production never resubmits a reference.'
  );
  // A status check by reference returns the ORIGINAL booking, so it cannot
  // show whether an accepted repeat settled or was deduplicated; a hidden or
  // lagging second booking looks identical to none. An accepted repeat is
  // therefore only ever `no` (a second row or debit was seen) or `unknown`.
  // Only a definitive rejection can show deduplication; an accepted or
  // indeterminate repeat may still have booked a hidden second transfer.
  const accepted = again.outcome !== 'rejected';
  const secondSeen =
    (rowsAfter !== null && rowsAfter > 1) ||
    (extraDebit !== null && extraDebit > 0);
  // A balance INCREASE (negative extra debit) is an unexplained credit, not a
  // second booking: it is never `no` and never a clean `yes`.
  const unexplainedCredit = extraDebit !== null && extraDebit < 0;
  // A usable list with fewer rows than the one already established is an
  // inconsistent read (lag, paging), not evidence about the repeat.
  const rowsShrank =
    rowsBefore !== null && rowsAfter !== null && rowsAfter < rowsBefore;
  const answer: Answer = secondSeen
    ? 'no'
    : rowsBefore === null ||
        rowsShrank ||
        unexplainedCredit ||
        rowsAfter === null ||
        extraDebit === null ||
        accepted
      ? 'unknown'
      : answerOf(rowsAfter === 1 && extraDebit === 0);
  b.finding(
    TAP_ONCE,
    TAP_ONCE_Q,
    answer,
    answer !== 'unknown'
      ? undefined
      : accepted && rowsAfter !== null && extraDebit !== null
        ? 'the repeat was accepted or its outcome is indeterminate and no second record or debit appeared, but its settlement or deduplication cannot be established from the original status'
        : 'the record list or the balances did not settle, so no count is published'
  );
}
