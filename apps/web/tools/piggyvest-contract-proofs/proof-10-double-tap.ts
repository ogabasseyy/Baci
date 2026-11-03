import { pickString } from './loose-schemas';
import { delta, readingOf, settledWallets, statusOf } from './poll';
import type { FundGoalResult } from './proof-10-fund-double-tap';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, usableList } from './read-rules';
import type { Answer } from './types';
import { EARLIER_UNSETTLED, WalletsQuiet } from './wallet-quiet';

/**
 * S8, step 5: tap the funding action a second time. A double tap must yield
 * exactly ONE provider transfer, measured on both layers: the app path (the
 * same slot sends nothing the second time) and the wire (the SAME reference
 * sent again must not debit twice or add a second record).
 */

export const TAP_SENDS_ONCE = 's8_double_tap_app_sends_once';
export const TAP_ONCE = 's8_double_tap_exactly_one_transfer';

const TAP_SENDS_Q =
  'Does a second tap with the same idempotency key send nothing new from the app?';
const TAP_ONCE_Q =
  'After a double tap on the wire, is there exactly one provider transfer and one debit?';

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
  fund: FundGoalResult | null,
  quiet: WalletsQuiet = new WalletsQuiet()
): Promise<boolean> {
  const { api, qa } = ctx;
  if (
    !fund?.sendAccepted ||
    !fund.terminalSuccess ||
    fund.mainBalanceKobo === null
  ) {
    // The wire repeat is only meaningful against a settled original: a still
    // pending one would settle later and look like a second debit.
    unknownTap(b, 'no settled, accepted goal funding to tap a second time');
    return true; // nothing was sent, so nothing is outstanding
  }
  const reference = fund.reference;
  const quietBefore = quiet.isQuiet(main, goal);

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
    quiet.markNotQuiet(main, goal);
    return false; // nothing about the repeat was reconciled in this run
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
  const answer: Answer = !quietBefore
    ? 'unknown'
    : secondSeen
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
      : !quietBefore
        ? EARLIER_UNSETTLED
        : accepted && rowsAfter !== null && extraDebit !== null
          ? 'the repeat was accepted or its outcome is indeterminate and no second record or debit appeared, but its settlement or deduplication cannot be established from the original status'
          : 'the record list or the balances did not settle, so no count is published'
  );
  // Is every balance movement of the repeat reconciled? A rejected repeat
  // with settled balances, or an accepted one whose debit was seen to land.
  // An accepted repeat with no debit seen may still land later.
  // An unexplained credit (negative extra debit) reconciles nothing.
  const reconciled =
    quietBefore &&
    extraDebit !== null &&
    (accepted ? extraDebit > 0 : extraDebit >= 0);
  if (!reconciled) quiet.markNotQuiet(main, goal);
  return reconciled;
}
